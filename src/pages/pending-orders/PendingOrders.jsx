import { useEffect, useMemo, useState } from 'react'
import { Search, ArrowUpDown, Lock, Hourglass } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { fmt, fmtDateDMY } from '../../lib/format'
import { getFY } from '../../lib/fy'
import { ORDER_SORTS, STATUS_FILTERS, orderStatus, orderMatchesQuery, nativeReceivedQtyForOrder, nativeOrderedQty } from '../../lib/orderHelpers'
import { useFY } from '../../context/FYContext'
import { Card, Input, Select, Empty, Header, StatusBadge } from '../../components/ui'

export default function PendingOrders() {
  const { currentFY, isClosed: fyLocked } = useFY()
  const [allOrders, setAllOrders] = useState(null)
  const [allReceipts, setAllReceipts] = useState(null)
  const [weavers, setWeavers] = useState([])
  const [pcsTotals, setPcsTotals] = useState({})

  const [weaverFilter, setWeaverFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('pending')
  const [sortKey, setSortKey] = useState('dateNewest')
  const [confirmAction, setConfirmAction] = useState(null) // { id, action: "close" | "short-close" }
  const [query, setQuery] = useState('')

  const load = async () => {
    const [{ data: orders }, { data: receipts }, { data: w }] = await Promise.all([
      supabase.from('production_orders').select('*').order('po_date', { ascending: false }),
      supabase.from('goods_receipts').select('*'),
      supabase.from('weavers').select('*').eq('is_active', true).order('name'),
    ])
    setAllOrders(orders ?? [])
    setAllReceipts(receipts ?? [])
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
  const receipts = allReceipts ?? []

  const visible = useMemo(() => {
    let list = orders
    if (weaverFilter) list = list.filter((o) => o.weaver_id === weaverFilter)
    if (statusFilter !== 'all') list = list.filter((o) => orderStatus(o) === statusFilter)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((o) => orderMatchesQuery(o, q))
    return [...list].sort(ORDER_SORTS[sortKey].fn)
  }, [orders, weaverFilter, statusFilter, sortKey, query])

  const setStatus = async (id, status) => {
    setConfirmAction(null)
    await supabase
      .from('production_orders')
      .update({ status, closed_at: status === 'pending' ? null : new Date().toISOString() })
      .eq('id', id)
    load()
  }

  if (allOrders === null) return null

  return (
    <div>
      <Header title="Pending Orders" subtitle="Ordered vs received for every Production Order — filter by weaver, and close one out once it's done." />
      {fyLocked && (
        <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-4 flex items-center gap-1.5">
          <Lock size={13} /> FY {currentFY} is closed — order status can't be changed. Switch to an open year from the sidebar.
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div className="relative max-w-xs flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search PO, design…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <Select value={weaverFilter} onChange={(e) => setWeaverFilter(e.target.value)} className="max-w-[220px]">
          <option value="">All weavers</option>
          {weavers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="max-w-[170px]">
          {Object.entries(STATUS_FILTERS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
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

      {visible.length === 0 ? (
        <Card>
          <Empty icon={Hourglass} title="No orders found" hint="Try a different weaver, status filter, or search term." />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((o) => {
            const ordered = nativeOrderedQty(o, pcsTotals[o.id])
            const received = nativeReceivedQtyForOrder(o.id, receipts)
            const balance = ordered - received
            const unitLabel = o.unit === 'Pcs' ? 'pcs' : 'mts'
            const status = orderStatus(o)
            return (
              <Card key={o.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-y-2 gap-x-4">
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-sm font-semibold text-stone-800">PO {o.po_no}</span>
                    <span style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }} className="px-2.5 py-0.5 rounded-full text-xs font-semibold">
                      {o.design_label}
                    </span>
                    <StatusBadge status={status} />
                  </div>
                  <div className="text-xs text-stone-500 mt-1">
                    {o.weaver_name} · {fmtDateDMY(o.po_date)} · {o.warp_yarn_type_name} ({o.warp_colour_name}){o.remarks && <> · {o.remarks}</>}
                  </div>
                  <div className="text-xs text-stone-500 mt-1">
                    Ordered <span className="font-semibold text-stone-700 font-mono">{fmt(ordered)} {unitLabel}</span>
                    {'  ·  '}Received <span className="font-semibold text-stone-700 font-mono">{fmt(received)} {unitLabel}</span>
                    {'  ·  '}Balance{' '}
                    <span className="font-semibold font-mono" style={{ color: balance > 0 ? '#B45309' : '#0D9488' }}>
                      {fmt(balance)} {unitLabel}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs font-medium">
                  {fyLocked ? (
                    <span className="text-stone-300">Locked</span>
                  ) : status === 'pending' ? (
                    confirmAction?.id === o.id ? (
                      <span className="flex items-center gap-2">
                        <span className="text-stone-500">{confirmAction.action === 'close' ? 'Mark fully closed?' : 'Short close with this balance?'}</span>
                        <button onClick={() => setStatus(o.id, confirmAction.action === 'close' ? 'closed' : 'short-closed')} className="font-semibold underline text-[#0D9488]">
                          Confirm
                        </button>
                        <button onClick={() => setConfirmAction(null)} className="font-semibold text-stone-500">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <>
                        <button onClick={() => setConfirmAction({ id: o.id, action: 'close' })} className="text-[#0D9488] hover:underline">
                          Close
                        </button>
                        <button onClick={() => setConfirmAction({ id: o.id, action: 'short-close' })} className="text-stone-500 hover:text-stone-700">
                          Short Close
                        </button>
                      </>
                    )
                  ) : (
                    <button onClick={() => setStatus(o.id, 'pending')} className="text-stone-400 hover:text-[#0D9488]">
                      Reopen
                    </button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
