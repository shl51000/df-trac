import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, ArrowUpDown, ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { getFY } from '../../lib/fy'
import { ORDER_SORTS, orderStatus, orderMatchesQuery } from '../../lib/orderHelpers'
import { useAuth } from '../../context/AuthContext'
import { useFY } from '../../context/FYContext'
import { Input, Select, Btn, Header } from '../../components/ui'
import ProductionOrdersList from './ProductionOrdersList'
import ManualProductionOrderForm from './ManualProductionOrderForm'
import NewProductionOrderFlow from './NewProductionOrderFlow'
import OrderSlip from './OrderSlip'

async function fetchOrderChildren(orderId) {
  const [{ data: fq }, { data: lines }] = await Promise.all([
    supabase.from('production_order_feeder_quality').select('*').eq('production_order_id', orderId).order('feeder_no'),
    supabase.from('production_order_lines').select('*').eq('production_order_id', orderId).order('sl'),
  ])
  const lineIds = (lines ?? []).map((l) => l.id)
  const { data: lineColours } = lineIds.length ? await supabase.from('production_order_line_colours').select('*').in('line_id', lineIds) : { data: [] }
  const linesWithColours = (lines ?? []).map((l) => ({ ...l, colours: (lineColours ?? []).filter((c) => c.line_id === l.id).sort((a, b) => a.feeder_no - b.feeder_no) }))
  return { feederQuality: fq ?? [], lines: linesWithColours }
}

export default function ProductionOrders() {
  const { isAdmin } = useAuth()
  const { currentFY, isClosed: fyLocked } = useFY()
  const [view, setView] = useState('list') // "list" | "new" | "edit" | "slip"
  const [allOrders, setAllOrders] = useState(null)
  const [pcsTotals, setPcsTotals] = useState({})
  const [weavers, setWeavers] = useState([])
  const [editingOrder, setEditingOrder] = useState(null)
  const [slipOrder, setSlipOrder] = useState(null)

  const [weaverFilter, setWeaverFilter] = useState('')
  const [sortKey, setSortKey] = useState('dateNewest')
  const [query, setQuery] = useState('')
  const [activeExpanded, setActiveExpanded] = useState(true)
  const [closedExpanded, setClosedExpanded] = useState(false)

  const load = async () => {
    const [{ data: orders }, { data: w }] = await Promise.all([
      supabase.from('production_orders').select('*').order('po_date', { ascending: false }),
      supabase.from('weavers').select('*').eq('is_active', true).order('name'),
    ])
    setAllOrders(orders ?? [])
    setWeavers(w ?? [])
    const pcsOrderIds = (orders ?? []).filter((o) => o.unit === 'Pcs').map((o) => o.id)
    if (pcsOrderIds.length) {
      const { data: lineRows } = await supabase.from('production_order_lines').select('production_order_id, qty').in('production_order_id', pcsOrderIds)
      const totals = {}
      ;(lineRows ?? []).forEach((r) => {
        totals[r.production_order_id] = (totals[r.production_order_id] || 0) + (Number(r.qty) || 0)
      })
      setPcsTotals(totals)
    } else {
      setPcsTotals({})
    }
  }
  useEffect(() => {
    load()
  }, [])

  const orders = useMemo(() => (allOrders ?? []).filter((o) => getFY(o.po_date) === currentFY), [allOrders, currentFY])

  const filteredSorted = useMemo(() => {
    let list = weaverFilter ? orders.filter((o) => o.weaver_id === weaverFilter) : orders
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((o) => orderMatchesQuery(o, q))
    return [...list].sort(ORDER_SORTS[sortKey].fn)
  }, [orders, weaverFilter, sortKey, query])
  const activeOrders = filteredSorted.filter((o) => orderStatus(o) === 'pending')
  const closedOrders = filteredSorted.filter((o) => orderStatus(o) !== 'pending')

  const openSlip = async (id) => {
    const { data: order } = await supabase.from('production_orders').select('*').eq('id', id).single()
    const { feederQuality, lines } = await fetchOrderChildren(id)
    setSlipOrder({ ...order, feederQuality, lines })
    setView('slip')
  }
  const openEdit = async (id) => {
    const { data: order } = await supabase.from('production_orders').select('*').eq('id', id).single()
    const { feederQuality, lines } = await fetchOrderChildren(id)
    setEditingOrder({ ...order, feederQuality, lines: lines.map((l) => ({ ...l, colours: l.colours.map((c) => c.colour_id) })) })
    setView('edit')
  }
  const removeOrder = async (id) => {
    const { error } = await supabase.from('production_orders').delete().eq('id', id)
    if (error) return friendlyError(error, { onInUse: "Has goods receipts recorded against it — can't delete." })
    load()
    return null
  }

  if (allOrders === null) return null

  if (view === 'new') {
    return (
      <NewProductionOrderFlow
        onCancel={() => setView('list')}
        onSaved={(id) => {
          load()
          openSlip(id)
        }}
      />
    )
  }
  if (view === 'edit' && editingOrder) {
    return (
      <ManualProductionOrderForm
        editingOrder={editingOrder}
        onBack={() => {
          setView('list')
          setEditingOrder(null)
        }}
        onCancel={() => {
          setView('list')
          setEditingOrder(null)
        }}
        onSaved={(id) => {
          setEditingOrder(null)
          load()
          openSlip(id)
        }}
      />
    )
  }
  if (view === 'slip' && slipOrder) {
    return (
      <OrderSlip
        order={slipOrder}
        onBack={() => {
          setView('list')
          setSlipOrder(null)
        }}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <Header title="Production Orders" subtitle="Weaver, design, and a colour + quantity per feeder — Reed and Base Pick come from the design automatically." />
        <Btn onClick={() => setView('new')} disabled={fyLocked}>
          <Plus size={15} /> New Production Order
        </Btn>
      </div>
      {fyLocked && (
        <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 flex items-center gap-1.5">
          <Lock size={13} /> FY {currentFY} is closed — read-only. Switch to an open year from the sidebar to make changes.
        </div>
      )}

      {orders.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-5">
          <div className="relative max-w-xs flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="Search PO no, design no…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          </div>
          <Select value={weaverFilter} onChange={(e) => setWeaverFilter(e.target.value)} className="max-w-[220px]">
            <option value="">All weavers</option>
            {weavers.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <div className="relative">
            <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="rounded border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none"
            >
              {Object.entries(ORDER_SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {orders.length === 0 ? (
        <ProductionOrdersList orders={[]} pcsTotals={pcsTotals} emptyHint='Add one with "New Production Order".' />
      ) : (
        <>
          <button onClick={() => setActiveExpanded((v) => !v)} className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 hover:text-stone-700">
            {activeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Active ({activeOrders.length})
          </button>
          {activeExpanded && (
            <ProductionOrdersList
              orders={activeOrders}
              pcsTotals={pcsTotals}
              onDelete={removeOrder}
              onView={openSlip}
              onEdit={openEdit}
              canDelete={isAdmin && !fyLocked}
              canEdit={!fyLocked}
              emptyHint="No active orders match this filter."
            />
          )}

          <button onClick={() => setClosedExpanded((v) => !v)} className="mt-6 mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500 hover:text-stone-700">
            {closedExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Closed ({closedOrders.length})
          </button>
          {closedExpanded && (
            <ProductionOrdersList
              orders={closedOrders}
              pcsTotals={pcsTotals}
              onDelete={removeOrder}
              onView={openSlip}
              onEdit={openEdit}
              canDelete={isAdmin && !fyLocked}
              canEdit={!fyLocked}
              emptyHint="No closed orders match this filter."
            />
          )}
        </>
      )}
    </div>
  )
}
