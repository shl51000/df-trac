import { useEffect, useMemo, useState } from 'react'
import { Search, ArrowUpDown, ChevronDown, ChevronRight, Scale } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { fmt, fmtDateDMY } from '../../lib/format'
import { getFY, todayISO } from '../../lib/fy'
import { ORDER_SORTS, orderStatus, orderMatchesQuery, formatOrderQty } from '../../lib/orderHelpers'
import { buildColourLedger } from '../../lib/yarnLedger'
import { useFY } from '../../context/FYContext'
import { Card, Input, Select, Empty, Header } from '../../components/ui'
import ColourLedgerModal from '../../components/ColourLedgerModal'

export default function YarnRequired() {
  const { currentFY } = useFY()
  const [weavers, setWeavers] = useState([])
  const [yarnTypes, setYarnTypes] = useState([]) // each with .colours
  const [allOrders, setAllOrders] = useState(null)
  const [requirementRows, setRequirementRows] = useState([]) // v_po_yarn_requirement, this FY
  const [ledgerRows, setLedgerRows] = useState([]) // v_yarn_ledger, this FY, every weaver
  const [allIssues, setAllIssues] = useState([]) // yarn_issues, this FY
  const [issueItems, setIssueItems] = useState([]) // yarn_issue_items for the above issues

  const [weaverFilter, setWeaverFilter] = useState('')
  const [sortKey, setSortKey] = useState('dateNewest')
  const [expandedYarnTypeId, setExpandedYarnTypeId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [summaryQuery, setSummaryQuery] = useState('')
  const [orderQuery, setOrderQuery] = useState('')
  const [ledger, setLedger] = useState(null)

  useEffect(() => {
    supabase
      .from('weavers')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setWeavers(data ?? []))
    Promise.all([supabase.from('yarn_types').select('*').order('name'), supabase.from('yarn_colours').select('*')]).then(([{ data: yt }, { data: yc }]) => {
      setYarnTypes((yt ?? []).map((y) => ({ ...y, colours: (yc ?? []).filter((c) => c.yarn_type_id === y.id) })))
    })
  }, [])

  useEffect(() => {
    supabase
      .from('production_orders')
      .select('id, po_no, po_date, design_label, weaver_id, weaver_name, warp_yarn_type_name, warp_colour_name, remarks, unit, total_mtrs, status')
      .then(({ data }) => setAllOrders(data ?? []))
    supabase
      .from('v_po_yarn_requirement')
      .select('*')
      .eq('fy', currentFY)
      .then(({ data }) => setRequirementRows(data ?? []))
    supabase
      .from('v_yarn_ledger')
      .select('*')
      .eq('fy', currentFY)
      .then(({ data }) => setLedgerRows(data ?? []))
    supabase
      .from('yarn_issues')
      .select('id, issue_no, issue_date, weaver_id')
      .then(async ({ data: issues }) => {
        setAllIssues(issues ?? [])
        const ids = (issues ?? []).map((i) => i.id)
        if (!ids.length) return setIssueItems([])
        const { data: items } = await supabase.from('yarn_issue_items').select('yarn_issue_id, yarn_type_id, colour_id, qty').in('yarn_issue_id', ids)
        setIssueItems(items ?? [])
      })
  }, [currentFY])

  const ordersById = useMemo(() => Object.fromEntries((allOrders ?? []).map((o) => [o.id, o])), [allOrders])
  const yarnTypesById = useMemo(() => Object.fromEntries(yarnTypes.map((y) => [y.id, y])), [yarnTypes])
  const coloursById = useMemo(() => Object.fromEntries(yarnTypes.flatMap((y) => y.colours.map((c) => [c.id, c]))), [yarnTypes])
  const issuesInFY = useMemo(() => allIssues.filter((i) => getFY(i.issue_date) === currentFY), [allIssues, currentFY])

  // Every requirement row (weft or warp) that matches the weaver filter —
  // regardless of order status, since Yarn Issued already accounts for
  // what a closed order actually consumed.
  const weaverFilteredReq = useMemo(
    () => (weaverFilter ? requirementRows.filter((r) => r.weaver_id === weaverFilter) : requirementRows),
    [requirementRows, weaverFilter]
  )

  // Grouped by production order for the "By Production Order" section.
  const perOrder = useMemo(() => {
    const byOrder = {}
    weaverFilteredReq.forEach((r) => {
      ;(byOrder[r.production_order_id] ??= []).push(r)
    })
    return Object.entries(byOrder)
      .map(([poId, rows]) => ({ order: ordersById[poId], rows, totalKg: rows.reduce((s, r) => s + (Number(r.kg) || 0), 0) }))
      .filter((x) => x.order)
  }, [weaverFilteredReq, ordersById])

  // Ledger rows already come pre-telescoped from the DB (opening/closing
  // balance per weaver+yarn+colour) — summing each weaver's own already-
  // telescoped figures across weavers gives the same result as computing
  // the telescope on pre-summed data, so "All weavers" never needs a
  // second query.
  const groupedSummary = useMemo(() => {
    const scoped = weaverFilter ? ledgerRows.filter((r) => r.weaver_id === weaverFilter) : ledgerRows
    const byKey = {}
    scoped.forEach((row) => {
      const key = `${row.yarn_type_id}|${row.colour_id}`
      if (!byKey[key]) byKey[key] = { yarn_type_id: row.yarn_type_id, colour_id: row.colour_id, required_kg: 0, issued_kg: 0, closing_balance: 0 }
      byKey[key].required_kg += Number(row.required_kg) || 0
      byKey[key].issued_kg += Number(row.issued_kg) || 0
      byKey[key].closing_balance += Number(row.closing_balance) || 0
    })

    const byYarnType = {}
    Object.values(byKey).forEach((row) => {
      const yt = yarnTypesById[row.yarn_type_id]
      const col = coloursById[row.colour_id]
      if (!yt || !col) return
      const netKg = Math.max(row.closing_balance, 0)
      const excessKg = Math.max(-row.closing_balance, 0)
      if (netKg <= 0 && excessKg <= 0) return
      const yarnTypeName = `${yt.name} ${yt.denier}`
      if (!byYarnType[yt.id]) byYarnType[yt.id] = { yarnTypeId: yt.id, yarnTypeName, colours: [] }
      byYarnType[yt.id].colours.push({ colourId: col.id, colourName: col.colour_name, requiredKg: row.required_kg, issuedKg: row.issued_kg, netKg, excessKg })
    })
    return Object.values(byYarnType)
      .map((g) => ({
        ...g,
        colours: [...g.colours].sort((a, b) => a.colourName.localeCompare(b.colourName)),
        subtotalNet: g.colours.reduce((s, c) => s + c.netKg, 0),
        subtotalExcess: g.colours.reduce((s, c) => s + c.excessKg, 0),
      }))
      .sort((a, b) => a.yarnTypeName.localeCompare(b.yarnTypeName))
  }, [ledgerRows, weaverFilter, yarnTypesById, coloursById])
  const grandTotalNetKg = groupedSummary.reduce((s, g) => s + g.subtotalNet, 0)
  const grandTotalExcessKg = groupedSummary.reduce((s, g) => s + g.subtotalExcess, 0)

  const visibleGroups = useMemo(() => {
    const q = summaryQuery.trim().toLowerCase()
    if (!q) return groupedSummary
    return groupedSummary
      .map((g) => {
        const yarnMatches = g.yarnTypeName.toLowerCase().includes(q)
        const colours = yarnMatches ? g.colours : g.colours.filter((c) => c.colourName.toLowerCase().includes(q))
        return { ...g, colours }
      })
      .filter((g) => g.colours.length > 0)
  }, [groupedSummary, summaryQuery])

  // Only active (pending) orders belong in the by-order breakdown — a
  // closed or short-closed order is done, so it's no longer "required".
  const activePerOrder = useMemo(() => {
    const active = perOrder.filter(({ order }) => orderStatus(order) === 'pending')
    const sorted = [...active].sort((a, b) => ORDER_SORTS[sortKey].fn(a.order, b.order))
    const q = orderQuery.trim().toLowerCase()
    return q ? sorted.filter(({ order }) => orderMatchesQuery(order, q)) : sorted
  }, [perOrder, sortKey, orderQuery])

  const openLedger = (yarnTypeId, colourId, yarnTypeName, colourName) =>
    setLedger(
      buildColourLedger({
        ledgerRows,
        requirementRows: weaverFilteredReq,
        issuesInFY,
        issueItems,
        weaverFilter,
        currentFY,
        yarnTypeId,
        colourId,
        yarnTypeName,
        colourName,
        reportDate: todayISO(),
      })
    )

  if (allOrders === null) return null

  return (
    <div>
      <Header title="Yarn Required" />

      <div className="flex items-center gap-2 flex-wrap mb-5">
        <Select value={weaverFilter} onChange={(e) => setWeaverFilter(e.target.value)} className="max-w-[220px]">
          <option value="">All weavers</option>
          {weavers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>

      <Card className="mb-6">
        <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700">Summary — net kgs required (after Yarn Issued)</h2>
          <div className="relative max-w-[220px] flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="Search yarn or colour…" value={summaryQuery} onChange={(e) => setSummaryQuery(e.target.value)} className="pl-7 py-1.5 text-xs" />
          </div>
        </div>
        {groupedSummary.length === 0 ? (
          <Empty icon={Scale} title="Nothing to calculate" hint="No Production Orders match this filter yet." />
        ) : visibleGroups.length === 0 ? (
          <Empty icon={Search} title="No matches" hint="Try a different search term." />
        ) : (
          <>
            <div className="divide-y divide-stone-100">
              {visibleGroups.map((g) => (
                <div key={g.yarnTypeId}>
                  <div
                    className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none hover:bg-stone-50"
                    onClick={() => setExpandedYarnTypeId(expandedYarnTypeId === g.yarnTypeId ? null : g.yarnTypeId)}
                  >
                    <div className="flex items-center gap-2">
                      {expandedYarnTypeId === g.yarnTypeId ? <ChevronDown size={15} className="text-stone-400" /> : <ChevronRight size={15} className="text-stone-400" />}
                      <span className="text-sm font-semibold text-stone-800">{g.yarnTypeName}</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm font-semibold">
                      <span className="font-mono" style={{ color: '#DC2626' }}>
                        {fmt(g.subtotalNet)} kg
                      </span>
                      <span className="font-mono" style={{ color: '#16A34A' }}>
                        {fmt(g.subtotalExcess)} kg
                      </span>
                    </div>
                  </div>
                  {expandedYarnTypeId === g.yarnTypeId && (
                    <div style={{ backgroundColor: '#FAFAF9' }} className="px-4 py-2 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-stone-400 text-xs">
                            <th className="text-left font-semibold py-1">Colour</th>
                            <th className="text-right font-semibold py-1">Required</th>
                            <th className="text-right font-semibold py-1">Issued</th>
                            <th className="text-right font-semibold py-1">Net Required</th>
                            <th className="text-right font-semibold py-1">Excess</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.colours.map((c) => (
                            <tr
                              key={c.colourId}
                              className="border-t border-stone-200 cursor-pointer hover:bg-stone-100"
                              onClick={() => openLedger(g.yarnTypeId, c.colourId, g.yarnTypeName, c.colourName)}
                            >
                              <td className="py-1.5 text-stone-800 underline decoration-dotted decoration-stone-300">{c.colourName}</td>
                              <td className="py-1.5 text-right font-mono text-stone-500">{fmt(c.requiredKg)}</td>
                              <td className="py-1.5 text-right font-mono text-stone-500">{fmt(c.issuedKg)}</td>
                              <td className="py-1.5 text-right font-mono font-medium" style={{ color: '#DC2626' }}>
                                {fmt(c.netKg)}
                              </td>
                              <td className="py-1.5 text-right font-mono font-medium" style={{ color: '#16A34A' }}>
                                {fmt(c.excessKg)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 border-t border-stone-200 flex items-center justify-end gap-4 text-sm font-semibold">
              <span className="text-stone-500 text-xs uppercase tracking-wide">Total</span>
              <span className="font-mono" style={{ color: '#DC2626' }}>
                {fmt(grandTotalNetKg)} kg
              </span>
              <span className="font-mono" style={{ color: '#16A34A' }}>
                {fmt(grandTotalExcessKg)} kg
              </span>
            </div>
          </>
        )}
      </Card>

      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-500">By Production Order — active orders only</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative max-w-[200px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="Search PO, design…" value={orderQuery} onChange={(e) => setOrderQuery(e.target.value)} className="pl-7 py-1.5 text-xs" />
          </div>
          <div className="relative">
            <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="rounded border border-stone-300 bg-white pl-7 pr-3 py-1.5 text-xs text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none"
            >
              {Object.entries(ORDER_SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {activePerOrder.length === 0 ? (
        <Card>
          <Empty icon={Scale} title="No active orders" hint="Try a different weaver filter or search term." />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {activePerOrder.map(({ order, rows, totalKg }) => (
            <Card key={order.id}>
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer select-none flex-wrap gap-y-1"
                onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
              >
                <div className="flex items-center gap-2.5 flex-wrap">
                  {expandedId === order.id ? <ChevronDown size={16} className="text-stone-400" /> : <ChevronRight size={16} className="text-stone-400" />}
                  <span className="text-sm font-semibold text-stone-800">PO {order.po_no}</span>
                  <span style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }} className="px-2.5 py-0.5 rounded-full text-xs font-semibold">
                    {order.design_label}
                  </span>
                  <span className="text-xs text-stone-400">{fmtDateDMY(order.po_date)}</span>
                  <span className="text-xs text-stone-500">{formatOrderQty(order)}</span>
                  <span className="text-xs text-stone-500">
                    {order.warp_yarn_type_name} ({order.warp_colour_name}){order.remarks && <> · {order.remarks}</>}
                  </span>
                </div>
                <span className="text-sm font-semibold font-mono" style={{ color: '#DC2626' }}>
                  {fmt(totalKg)} kg
                </span>
              </div>
              {expandedId === order.id && (
                <div className="px-4 pb-4 border-t border-stone-200 overflow-x-auto">
                  <table className="w-full text-xs mt-3">
                    <thead>
                      <tr className="text-stone-400">
                        <th className="text-left font-semibold pb-1 pr-3">Feeder</th>
                        <th className="text-left font-semibold pb-1 pr-3">Yarn Quality</th>
                        <th className="text-left font-semibold pb-1 pr-3">Colour</th>
                        <th className="text-right font-semibold pb-1 pr-3">Qty (mtrs)</th>
                        <th className="text-right font-semibold pb-1">Kgs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t border-stone-100">
                          <td className="py-1 pr-3 text-stone-500">{r.is_warp ? 'Warp' : `F${r.feeder_no}`}</td>
                          <td className="py-1 pr-3 text-stone-800">{r.yarn_type_name}</td>
                          <td className="py-1 pr-3 text-stone-800">{r.colour_name}</td>
                          <td className="py-1 pr-3 text-right font-mono">{fmt(r.qty_mtrs)}</td>
                          <td className="py-1 text-right font-mono">{fmt(r.kg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {ledger && <ColourLedgerModal ledger={ledger} onClose={() => setLedger(null)} />}
    </div>
  )
}
