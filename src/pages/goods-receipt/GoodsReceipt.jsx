import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Search, ArrowUpDown, Lock, PackageCheck } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { fmt, fmtDateDMY } from '../../lib/format'
import { todayISO, getFY } from '../../lib/fy'
import { lineMtsEquivalent } from '../../lib/design'
import { orderStatus, formatOrderQty, nativeReceivedQtyForOrder, nativeOrderedQty } from '../../lib/orderHelpers'
import { useAuth } from '../../context/AuthContext'
import { useFY } from '../../context/FYContext'
import { Card, Label, Input, Select, SearchSelect, Btn, Empty, Header, IconBtn } from '../../components/ui'

const RECEIPT_SORTS = {
  dateNewest: { label: 'Date (newest)', fn: (a, b) => b.inv_date.localeCompare(a.inv_date) },
  dateOldest: { label: 'Date (oldest)', fn: (a, b) => a.inv_date.localeCompare(b.inv_date) },
  invNoAsc: { label: 'Invoice No (A–Z)', fn: (a, b) => a.inv_no.localeCompare(b.inv_no) },
}

export default function GoodsReceipt() {
  const { isAdmin } = useAuth()
  const { currentFY, isClosed: fyLocked } = useFY()
  const [allOrders, setAllOrders] = useState(null)
  const [allReceipts, setAllReceipts] = useState(null)
  const [weavers, setWeavers] = useState([])
  const [pcsTotals, setPcsTotals] = useState({})

  const [invNo, setInvNo] = useState('')
  const [invDate, setInvDate] = useState(todayISO())
  const [weaverId, setWeaverId] = useState('')
  const [poId, setPoId] = useState('')
  const [qty, setQty] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const [receiptWeaverFilter, setReceiptWeaverFilter] = useState('')
  const [receiptSortKey, setReceiptSortKey] = useState('dateNewest')
  const [receiptQuery, setReceiptQuery] = useState('')

  const load = async () => {
    const [{ data: orders }, { data: receipts }, { data: w }] = await Promise.all([
      supabase.from('production_orders').select('*').order('po_date', { ascending: false }),
      supabase.from('goods_receipts').select('*').order('inv_date', { ascending: false }),
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
  const receipts = useMemo(() => (allReceipts ?? []).filter((r) => getFY(r.inv_date) === currentFY), [allReceipts, currentFY])

  const visibleReceipts = useMemo(() => {
    let list = receiptWeaverFilter ? receipts.filter((r) => r.weaver_id === receiptWeaverFilter) : receipts
    const q = receiptQuery.trim().toLowerCase()
    if (q) list = list.filter((r) => `${r.inv_no} ${r.po_no} ${r.design_label} ${r.weaver_name}`.toLowerCase().includes(q))
    return [...list].sort(RECEIPT_SORTS[receiptSortKey].fn)
  }, [receipts, receiptWeaverFilter, receiptSortKey, receiptQuery])

  const pendingOrdersForWeaver = weaverId ? orders.filter((o) => o.weaver_id === weaverId && orderStatus(o) === 'pending') : []
  const selectedPo = poId ? orders.find((o) => o.id === poId) : null
  const unit = selectedPo?.unit || 'Mts'
  const cutSize = selectedPo?.cut_size_used || 1
  const mtsPreview = unit === 'Pcs' ? lineMtsEquivalent(qty, 'Pcs', cutSize) : null

  const submit = async () => {
    if (fyLocked) return setError(`FY ${currentFY} is closed — switch to an open year to add receipts.`)
    const n = invNo.trim()
    if (!n) return setError('Invoice No is required.')
    if (!invDate) return setError('Invoice date is required.')
    if (getFY(invDate) !== currentFY) return setError(`Invoice date must fall within the selected FY (${currentFY}) — switch FY in the sidebar first if this date belongs to a different year.`)
    if (!weaverId) return setError('Select a weaver.')
    if (!poId) return setError('Select a PO.')
    const q = qty.trim()
    if (!q || Number(q) <= 0) return setError('Enter a quantity received.')

    setSaving(true)
    const weaver = weavers.find((w) => w.id === weaverId)
    const mts = unit === 'Pcs' ? lineMtsEquivalent(q, 'Pcs', cutSize) : Number(q)
    const { error: insErr } = await supabase.from('goods_receipts').insert({
      inv_no: n,
      inv_date: invDate,
      weaver_id: weaverId,
      weaver_name: weaver.name,
      po_id: selectedPo.id,
      po_no: selectedPo.po_no,
      design_label: selectedPo.design_label,
      unit,
      qty: q,
      mts,
    })
    setSaving(false)
    if (insErr) return setError(friendlyError(insErr, { onDuplicate: `Invoice "${n}" is already recorded for this weaver.` }))
    setInvNo('')
    setQty('')
    setError('')
    // Weaver and PO stay selected — quick to log another lot against the same order.
    load()
  }

  const removeReceipt = async (id) => {
    const { error: delErr } = await supabase.from('goods_receipts').delete().eq('id', id)
    setConfirmDeleteId(null)
    if (delErr) return setError(friendlyError(delErr))
    load()
  }

  if (allOrders === null) return null

  return (
    <div>
      <Header title="Goods Receipt" subtitle="Record fabric received from a weaver against a Production Order — design-wise, one entry per lot." />
      {fyLocked && (
        <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 flex items-center gap-1.5">
          <Lock size={13} /> FY {currentFY} is closed — read-only. Switch to an open year from the sidebar to make changes.
        </div>
      )}

      <Card className="p-5 max-w-lg mb-6">
        <Label>New receipt</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Invoice No</Label>
            <Input
              placeholder="e.g. INV-118"
              value={invNo}
              onChange={(e) => {
                setInvNo(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Invoice date</Label>
            <Input
              type="date"
              value={invDate}
              onChange={(e) => {
                setInvDate(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Weaver name</Label>
            <Select
              value={weaverId}
              onChange={(e) => {
                setWeaverId(e.target.value)
                setPoId('')
                setError('')
              }}
            >
              <option value="">Select weaver…</option>
              {weavers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>PO number</Label>
            <SearchSelect
              value={poId}
              onChange={(v) => {
                setPoId(v)
                setError('')
              }}
              options={pendingOrdersForWeaver.map((o) => ({ value: o.id, label: `PO ${o.po_no} — ${o.design_label}` }))}
              placeholder={!weaverId ? 'Pick weaver first' : pendingOrdersForWeaver.length ? 'Search PO no or design…' : 'No pending POs for this weaver'}
              disabled={!weaverId}
            />
          </div>
          <div className="col-span-2">
            <Label>Qty received ({unit})</Label>
            <Input
              value={qty}
              onChange={(e) => {
                setQty(e.target.value)
                setError('')
              }}
              placeholder={unit === 'Pcs' ? 'e.g. 100' : 'e.g. 400'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
            {unit === 'Pcs' && qty.trim() && <div className="text-xs text-stone-500 mt-1">≈ {fmt(mtsPreview)} mts (auto, Cut Size {cutSize})</div>}
          </div>
        </div>
        {selectedPo &&
          (() => {
            const ordered = nativeOrderedQty(selectedPo, pcsTotals[selectedPo.id])
            const received = nativeReceivedQtyForOrder(selectedPo.id, receipts)
            return (
              <div className="mt-3 text-xs text-stone-500">
                Ordered <span className="font-semibold text-stone-700 font-mono">{fmt(ordered)} {unit.toLowerCase()}</span>
                {'  ·  '}Received so far <span className="font-semibold text-stone-700 font-mono">{fmt(received)} {unit.toLowerCase()}</span>
                {'  ·  '}Balance <span className="font-semibold text-stone-700 font-mono">{fmt(ordered - received)} {unit.toLowerCase()}</span>
              </div>
            )
          })()}
        {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
        <div className="pt-4 mt-1 border-t border-stone-200 flex gap-2">
          <Btn onClick={submit} disabled={fyLocked || saving}>
            <Plus size={15} /> {saving ? 'Adding…' : 'Add receipt'}
          </Btn>
        </div>
      </Card>

      {receipts.length === 0 ? (
        <Card>
          <Empty icon={PackageCheck} title="No receipts yet" hint="Record fabric received from a weaver above." />
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <div className="relative max-w-xs flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <Input placeholder="Search invoice, PO, design…" value={receiptQuery} onChange={(e) => setReceiptQuery(e.target.value)} className="pl-8" />
            </div>
            <Select value={receiptWeaverFilter} onChange={(e) => setReceiptWeaverFilter(e.target.value)} className="max-w-[220px]">
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
                value={receiptSortKey}
                onChange={(e) => setReceiptSortKey(e.target.value)}
                className="rounded border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none"
              >
                {Object.entries(RECEIPT_SORTS).map(([key, s]) => (
                  <option key={key} value={key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Card>
            {visibleReceipts.length === 0 ? (
              <Empty icon={Search} title="No matches" hint="Try a different weaver filter." />
            ) : (
              <div className="divide-y divide-stone-100">
                {visibleReceipts.map((r) => {
                  const po = orders.find((o) => o.id === r.po_id)
                  return (
                    <div key={r.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <div className="text-sm font-semibold text-stone-800">
                          {r.inv_no} <span className="text-stone-400 font-normal">· {fmtDateDMY(r.inv_date)}</span>
                        </div>
                        <div className="text-xs text-stone-500 mt-0.5">
                          {r.weaver_name} · PO {r.po_no} · {r.design_label}
                          {po && (
                            <>
                              {' '}
                              · {formatOrderQty(po)} · {po.warp_yarn_type_name} ({po.warp_colour_name}){po.remarks && <> · {po.remarks}</>}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold font-mono" style={{ color: '#0D9488' }}>
                          {fmt(r.qty)} {(r.unit || 'Mts').toLowerCase()}
                          {r.unit === 'Pcs' && r.mts != null && <span className="text-stone-400 font-normal"> ({fmt(r.mts)} mts)</span>}
                        </span>
                        {isAdmin &&
                          !fyLocked &&
                          (confirmDeleteId === r.id ? (
                            <span className="flex items-center gap-2 text-xs">
                              <button onClick={() => removeReceipt(r.id)} className="font-semibold underline text-[#0D9488]">
                                Delete
                              </button>
                              <button onClick={() => setConfirmDeleteId(null)} className="font-semibold text-stone-500">
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <IconBtn title="Delete" danger onClick={() => setConfirmDeleteId(r.id)}>
                              <Trash2 size={14} />
                            </IconBtn>
                          ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
