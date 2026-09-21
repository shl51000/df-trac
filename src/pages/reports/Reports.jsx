import { useEffect, useMemo, useRef, useState } from 'react'
import { Printer, FileSpreadsheet, ClipboardList, Search } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { fmt, fmtDateDMY } from '../../lib/format'
import { formatOrderQty } from '../../lib/orderHelpers'
import { downloadCSV } from '../../lib/print'
import { useFY } from '../../context/FYContext'
import { Card, Select, Input, Btn, Empty, Header } from '../../components/ui'

const REPORT_TYPES = [
  { key: 'po', label: 'Production Orders' },
  { key: 'rmdc', label: 'RMDC Issue' },
  { key: 'gr', label: 'Goods Receipt' },
]

export default function Reports() {
  const { currentFY } = useFY()
  const [reportType, setReportType] = useState('po')
  const [weavers, setWeavers] = useState([])
  const [allOrders, setAllOrders] = useState(null)
  const [pcsTotals, setPcsTotals] = useState({})
  const [allIssues, setAllIssues] = useState(null)
  const [allReceipts, setAllReceipts] = useState(null)
  const [weaverFilter, setWeaverFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [query, setQuery] = useState('')
  const initializedRange = useRef(false)

  useEffect(() => {
    supabase.from('weavers').select('*').order('name').then(({ data }) => setWeavers(data ?? []))
    supabase
      .from('production_orders')
      .select('*')
      .order('po_date')
      .then(({ data }) => {
        setAllOrders(data ?? [])
        const pcsIds = (data ?? []).filter((o) => o.unit === 'Pcs').map((o) => o.id)
        if (!pcsIds.length) return setPcsTotals({})
        supabase
          .from('production_order_lines')
          .select('production_order_id, qty')
          .in('production_order_id', pcsIds)
          .then(({ data: lineRows }) => {
            const totals = {}
            ;(lineRows ?? []).forEach((r) => {
              totals[r.production_order_id] = (totals[r.production_order_id] || 0) + (Number(r.qty) || 0)
            })
            setPcsTotals(totals)
          })
      })
    supabase.from('yarn_issues').select('*').order('issue_date').then(({ data }) => setAllIssues(data ?? []))
    supabase.from('goods_receipts').select('*').order('inv_date').then(({ data }) => setAllReceipts(data ?? []))
  }, [])

  // Defaults to the current FY's own date range, once, the first time it's
  // known — a user-cleared/changed range after that is left alone.
  useEffect(() => {
    if (initializedRange.current || !currentFY) return
    initializedRange.current = true
    const startYear = Number(currentFY.split('-')[0])
    setFromDate(`${startYear}-04-01`)
    setToDate(`${startYear + 1}-03-31`)
  }, [currentFY])

  const relevantWeavers = useMemo(
    () => (weaverFilter ? weavers.filter((w) => w.id === weaverFilter) : weavers),
    [weavers, weaverFilter]
  )
  const inRange = (d) => (!fromDate || d >= fromDate) && (!toDate || d <= toDate)
  const q = query.trim().toLowerCase()

  // One grouped-by-weaver report per type — each group's own rows already
  // shaped for both the on-screen table and the CSV export, so the two
  // never disagree.
  const poGroups = useMemo(() => {
    if (!allOrders) return []
    const scoped = allOrders.filter((o) => inRange(o.po_date))
    return relevantWeavers
      .map((w) => ({
        weaver: w,
        rows: scoped
          .filter((o) => o.weaver_id === w.id)
          .sort((a, b) => a.po_date.localeCompare(b.po_date))
          .map((o) => ({
            poNo: o.po_no,
            poDate: o.po_date,
            designNo: o.design_no,
            width: o.width,
            basePick: o.pick,
            warpYarn: `${o.warp_yarn_type_name}${o.warp_colour_name ? ` (${o.warp_colour_name})` : ''}`,
            totalQty: formatOrderQty(o, pcsTotals[o.id]),
          }))
          .filter((r) => !q || w.name.toLowerCase().includes(q) || `${r.poNo} ${r.designNo} ${r.warpYarn}`.toLowerCase().includes(q)),
      }))
      .filter((g) => g.rows.length > 0)
  }, [allOrders, relevantWeavers, fromDate, toDate, pcsTotals, q])

  const rmdcGroups = useMemo(() => {
    if (!allIssues) return []
    const scoped = allIssues.filter((i) => inRange(i.issue_date))
    return relevantWeavers
      .map((w) => {
        const rows = scoped
          .filter((i) => i.weaver_id === w.id)
          .sort((a, b) => a.issue_date.localeCompare(b.issue_date))
          .map((i) => ({ rmdcNo: i.issue_no, rmdcDate: i.issue_date, totalQty: i.total_qty, totalAmount: i.total_amount, remarks: i.remarks || '' }))
          .filter((r) => !q || w.name.toLowerCase().includes(q) || `${r.rmdcNo} ${r.remarks}`.toLowerCase().includes(q))
        return { weaver: w, rows, subtotalQty: rows.reduce((s, r) => s + (Number(r.totalQty) || 0), 0), subtotalAmount: rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0) }
      })
      .filter((g) => g.rows.length > 0)
  }, [allIssues, relevantWeavers, fromDate, toDate, q])

  const grGroups = useMemo(() => {
    if (!allReceipts) return []
    const scoped = allReceipts.filter((r) => inRange(r.inv_date))
    return relevantWeavers
      .map((w) => {
        const rows = scoped
          .filter((r) => r.weaver_id === w.id)
          .sort((a, b) => a.inv_date.localeCompare(b.inv_date))
          .map((r) => ({
            invNo: r.inv_no,
            invDate: r.inv_date,
            poNo: r.po_no,
            designLabel: r.design_label,
            qty: r.unit === 'Pcs' ? `${fmt(r.qty)} pcs (${fmt(r.mts)} mts)` : `${fmt(r.mts)} mts`,
            mts: r.mts,
          }))
          .filter((r) => !q || w.name.toLowerCase().includes(q) || `${r.invNo} ${r.poNo} ${r.designLabel}`.toLowerCase().includes(q))
        return { weaver: w, rows, subtotalMts: rows.reduce((s, r) => s + (Number(r.mts) || 0), 0) }
      })
      .filter((g) => g.rows.length > 0)
  }, [allReceipts, relevantWeavers, fromDate, toDate, q])

  const groups = reportType === 'po' ? poGroups : reportType === 'rmdc' ? rmdcGroups : grGroups
  const loading = allOrders === null || allIssues === null || allReceipts === null
  const rangeLabel = fromDate && toDate ? `${fmtDateDMY(fromDate)} – ${fmtDateDMY(toDate)}` : 'all dates'

  const exportCSV = () => {
    const fileBase = `${REPORT_TYPES.find((t) => t.key === reportType).label.replace(/\s+/g, '-')}-${fromDate || 'start'}-to-${toDate || 'end'}`
    if (reportType === 'po') {
      const headers = ['Weaver', 'PO No', 'PO Date', 'Design No', 'Width', 'Base Pick', 'Warp Yarn (Colour)', 'Total Qty']
      const rows = poGroups.flatMap((g) => g.rows.map((r) => [g.weaver.name, r.poNo, fmtDateDMY(r.poDate), r.designNo, r.width, r.basePick, r.warpYarn, r.totalQty]))
      downloadCSV(`${fileBase}.csv`, headers, rows)
    } else if (reportType === 'rmdc') {
      const headers = ['Weaver', 'RMDC No', 'RMDC Date', 'Total Qty (kg)', 'Total Amount', 'Remarks']
      const rows = rmdcGroups.flatMap((g) => g.rows.map((r) => [g.weaver.name, r.rmdcNo, fmtDateDMY(r.rmdcDate), fmt(r.totalQty), fmt(r.totalAmount), r.remarks]))
      downloadCSV(`${fileBase}.csv`, headers, rows)
    } else {
      const headers = ['Weaver', 'Invoice No', 'Invoice Date', 'PO No', 'Design', 'Qty']
      const rows = grGroups.flatMap((g) => g.rows.map((r) => [g.weaver.name, r.invNo, fmtDateDMY(r.invDate), r.poNo, r.designLabel, r.qty]))
      downloadCSV(`${fileBase}.csv`, headers, rows)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3 print:hidden">
        <Header title="Reports" subtitle={`Weaver-wise reports for ${rangeLabel} — print or download as Excel (CSV).`} />
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </Btn>
          <Btn onClick={exportCSV}>
            <FileSpreadsheet size={14} /> Download Excel
          </Btn>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-5 print:hidden">
        <Select value={reportType} onChange={(e) => setReportType(e.target.value)} className="max-w-[200px]">
          {REPORT_TYPES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </Select>
        <Select value={weaverFilter} onChange={(e) => setWeaverFilter(e.target.value)} className="max-w-[200px]">
          <option value="">All weavers</option>
          {weavers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="max-w-[150px]" />
        <span className="text-xs text-stone-400">to</span>
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="max-w-[150px]" />
        <div className="relative max-w-[220px] flex-1 min-w-[160px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-7" />
        </div>
      </div>

      <div className="print-area bg-white">
        <div className="mb-4 hidden print:block">
          <div style={{ fontFamily: 'var(--font-wordmark)', color: '#7A1F2B' }} className="text-xl">
            SOUTH HANDLOOMS
          </div>
          <div className="text-sm font-semibold text-stone-700 mt-1">
            {REPORT_TYPES.find((t) => t.key === reportType).label} — {rangeLabel}
          </div>
        </div>

        {loading ? null : groups.length === 0 ? (
          <Card>
            <Empty icon={ClipboardList} title="Nothing to report" hint="No records match this filter." />
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((g) => (
              <Card key={g.weaver.id} className="overflow-hidden">
                <div className="px-4 py-2.5 border-b border-stone-200">
                  <span className="text-sm font-semibold text-stone-800">{g.weaver.name}</span>
                </div>
                <div className="overflow-x-auto">
                  {reportType === 'po' && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-stone-400 text-xs">
                          <th className="text-left font-semibold px-4 py-1.5">PO No</th>
                          <th className="text-left font-semibold px-2 py-1.5">PO Date</th>
                          <th className="text-left font-semibold px-2 py-1.5">Design No</th>
                          <th className="text-right font-semibold px-2 py-1.5">Width</th>
                          <th className="text-right font-semibold px-2 py-1.5">Base Pick</th>
                          <th className="text-left font-semibold px-2 py-1.5">Warp Yarn (Colour)</th>
                          <th className="text-right font-semibold px-4 py-1.5">Total Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r, i) => (
                          <tr key={i} className="border-t border-stone-100">
                            <td className="px-4 py-1.5 text-stone-800">{r.poNo}</td>
                            <td className="px-2 py-1.5 text-stone-500">{fmtDateDMY(r.poDate)}</td>
                            <td className="px-2 py-1.5 text-stone-800">{r.designNo}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-stone-500">{r.width}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-stone-500">{r.basePick}</td>
                            <td className="px-2 py-1.5 text-stone-800">{r.warpYarn}</td>
                            <td className="px-4 py-1.5 text-right font-mono font-medium text-stone-800">{r.totalQty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {reportType === 'rmdc' && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-stone-400 text-xs">
                          <th className="text-left font-semibold px-4 py-1.5">RMDC No</th>
                          <th className="text-left font-semibold px-2 py-1.5">RMDC Date</th>
                          <th className="text-right font-semibold px-2 py-1.5">Total Qty (kg)</th>
                          <th className="text-right font-semibold px-2 py-1.5">Total Amount</th>
                          <th className="text-left font-semibold px-4 py-1.5">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r, i) => (
                          <tr key={i} className="border-t border-stone-100">
                            <td className="px-4 py-1.5 text-stone-800">{r.rmdcNo}</td>
                            <td className="px-2 py-1.5 text-stone-500">{fmtDateDMY(r.rmdcDate)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-stone-800">{fmt(r.totalQty)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-stone-800">{fmt(r.totalAmount)}</td>
                            <td className="px-4 py-1.5 text-stone-500">{r.remarks}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-stone-200">
                          <td colSpan={2} className="px-4 py-1.5 text-right font-semibold text-stone-500 text-xs uppercase tracking-wide">
                            Subtotal
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono font-semibold text-stone-800">{fmt(g.subtotalQty)}</td>
                          <td className="px-2 py-1.5 text-right font-mono font-semibold text-stone-800">{fmt(g.subtotalAmount)}</td>
                          <td className="px-4 py-1.5"></td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                  {reportType === 'gr' && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-stone-400 text-xs">
                          <th className="text-left font-semibold px-4 py-1.5">Invoice No</th>
                          <th className="text-left font-semibold px-2 py-1.5">Invoice Date</th>
                          <th className="text-left font-semibold px-2 py-1.5">PO No</th>
                          <th className="text-left font-semibold px-2 py-1.5">Design</th>
                          <th className="text-right font-semibold px-4 py-1.5">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((r, i) => (
                          <tr key={i} className="border-t border-stone-100">
                            <td className="px-4 py-1.5 text-stone-800">{r.invNo}</td>
                            <td className="px-2 py-1.5 text-stone-500">{fmtDateDMY(r.invDate)}</td>
                            <td className="px-2 py-1.5 text-stone-800">{r.poNo}</td>
                            <td className="px-2 py-1.5 text-stone-800">{r.designLabel}</td>
                            <td className="px-4 py-1.5 text-right font-mono font-medium text-stone-800">{r.qty}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-stone-200">
                          <td colSpan={4} className="px-4 py-1.5 text-right font-semibold text-stone-500 text-xs uppercase tracking-wide">
                            Subtotal (mts)
                          </td>
                          <td className="px-4 py-1.5 text-right font-mono font-semibold text-stone-800">{fmt(g.subtotalMts)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
