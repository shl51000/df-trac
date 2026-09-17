import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, ChevronDown, ChevronRight, Printer, Download, Mail, Share2, Loader2, FileText, Warehouse } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { fmt, fmtDateDMY } from '../../lib/format'
import { getFY, todayISO } from '../../lib/fy'
import { captureElementAsJPG, downloadDataUrl, shareJPGOnWhatsApp, shareFileByEmail, downloadCSV } from '../../lib/print'
import { buildColourLedger } from '../../lib/yarnLedger'
import { useFY } from '../../context/FYContext'
import { Card, Input, Select, Btn, Empty, Header } from '../../components/ui'
import ColourLedgerModal from '../../components/ColourLedgerModal'

export default function StockInHand() {
  const { currentFY } = useFY()
  const [weavers, setWeavers] = useState([])
  const [allRequirementRows, setAllRequirementRows] = useState(null) // v_po_yarn_requirement, every FY
  const [allIssues, setAllIssues] = useState([]) // yarn_issues, every FY
  const [allIssueItems, setAllIssueItems] = useState([])
  const [ledgerRows, setLedgerRows] = useState([]) // v_yarn_ledger, currentFY only — drill-down opening balance

  const [weaverFilter, setWeaverFilter] = useState('')
  const [asOnDate, setAsOnDate] = useState(todayISO())
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const [expandedGroups, setExpandedGroups] = useState({}) // `${weaverId}|${yarnTypeName}` -> bool
  const [query, setQuery] = useState('')
  const [ledger, setLedger] = useState(null)
  const printRef = useRef(null)

  useEffect(() => {
    supabase
      .from('weavers')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setWeavers(data ?? []))
    supabase
      .from('v_po_yarn_requirement')
      .select('*')
      .then(({ data }) => setAllRequirementRows(data ?? []))
    supabase
      .from('yarn_issues')
      .select('id, issue_no, issue_date, weaver_id')
      .then(async ({ data: issues }) => {
        setAllIssues(issues ?? [])
        const ids = (issues ?? []).map((i) => i.id)
        if (!ids.length) return setAllIssueItems([])
        const { data: items } = await supabase.from('yarn_issue_items').select('yarn_issue_id, yarn_type_id, colour_id, yarn_type_name, colour_name, qty').in('yarn_issue_id', ids)
        setAllIssueItems(items ?? [])
      })
  }, [])

  useEffect(() => {
    supabase
      .from('v_yarn_ledger')
      .select('*')
      .eq('fy', currentFY)
      .then(({ data }) => setLedgerRows(data ?? []))
  }, [currentFY])

  const toggleGroup = (key) => setExpandedGroups((g) => ({ ...g, [key]: !g[key] }))

  const currentFYRequirementRows = useMemo(() => (allRequirementRows ?? []).filter((r) => r.fy === currentFY), [allRequirementRows, currentFY])
  const currentFYIssues = useMemo(() => allIssues.filter((i) => getFY(i.issue_date) === currentFY), [allIssues, currentFY])

  const rows = useMemo(() => {
    if (allRequirementRows === null) return []
    const relevantWeavers = weaverFilter ? weavers.filter((w) => w.id === weaverFilter) : weavers
    const ordersAsOf = allRequirementRows.filter((r) => !r.po_date || r.po_date <= asOnDate)
    const issueIdsAsOf = new Set(allIssues.filter((i) => !i.issue_date || i.issue_date <= asOnDate).map((i) => i.id))
    const itemsAsOf = allIssueItems.filter((it) => issueIdsAsOf.has(it.yarn_issue_id))

    return relevantWeavers
      .map((w) => {
        const requiredByKey = {}
        ordersAsOf
          .filter((r) => r.weaver_id === w.id)
          .forEach((r) => {
            if (!r.colour_id) return
            const key = `${r.yarn_type_id}|${r.colour_id}`
            requiredByKey[key] = (requiredByKey[key] || 0) + (Number(r.kg) || 0)
          })

        const weaverIssueIds = new Set(allIssues.filter((i) => i.weaver_id === w.id).map((i) => i.id))
        const issuedByKey = {}
        itemsAsOf
          .filter((it) => weaverIssueIds.has(it.yarn_issue_id))
          .forEach((it) => {
            const key = `${it.yarn_type_id}|${it.colour_id}`
            if (!issuedByKey[key]) issuedByKey[key] = { yarnTypeId: it.yarn_type_id, colourId: it.colour_id, yarnTypeName: it.yarn_type_name, colourName: it.colour_name, kg: 0 }
            issuedByKey[key].kg += Number(it.qty) || 0
          })

        // Zero or negative (issued not exceeding required) never shows up.
        const items = Object.entries(issuedByKey)
          .map(([key, iss]) => ({
            yarnTypeId: iss.yarnTypeId,
            colourId: iss.colourId,
            yarnTypeName: iss.yarnTypeName,
            colourName: iss.colourName,
            stockKg: Math.max(iss.kg - (requiredByKey[key] || 0), 0),
          }))
          .filter((it) => it.stockKg > 0)
          .sort((a, b) => a.yarnTypeName.localeCompare(b.yarnTypeName) || a.colourName.localeCompare(b.colourName))

        const groupsMap = {}
        items.forEach((it) => {
          if (!groupsMap[it.yarnTypeName]) groupsMap[it.yarnTypeName] = { yarnTypeName: it.yarnTypeName, colours: [], subtotalKg: 0 }
          groupsMap[it.yarnTypeName].colours.push(it)
          groupsMap[it.yarnTypeName].subtotalKg += it.stockKg
        })
        const groups = Object.values(groupsMap).sort((a, b) => a.yarnTypeName.localeCompare(b.yarnTypeName))

        return { weaver: w, groups, totalKg: items.reduce((s, it) => s + it.stockKg, 0) }
      })
      .filter((w) => w.groups.length > 0)
  }, [weaverFilter, asOnDate, weavers, allRequirementRows, allIssues, allIssueItems])

  const grandTotal = rows.reduce((s, w) => s + w.totalKg, 0)

  // Keyword search — matches a weaver's name outright, or narrows a
  // weaver's own groups/colours down to just the matching yarn or colour.
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows
      .map((w) => {
        if (w.weaver.name.toLowerCase().includes(q)) return w
        const groups = w.groups
          .map((g) => {
            const yarnMatches = g.yarnTypeName.toLowerCase().includes(q)
            const colours = yarnMatches ? g.colours : g.colours.filter((c) => c.colourName.toLowerCase().includes(q))
            return { ...g, colours }
          })
          .filter((g) => g.colours.length > 0)
        return { ...w, groups }
      })
      .filter((w) => w.groups.length > 0)
  }, [rows, query])

  const expandAllForShare = () => {
    const allKeys = {}
    rows.forEach(({ weaver, groups }) => groups.forEach((g) => { allKeys[`${weaver.id}|${g.yarnTypeName}`] = true }))
    return allKeys
  }
  const withExpandedCapture = (kind, run) => async () => {
    setBusy(kind)
    setToast('')
    const prevExpanded = expandedGroups
    setExpandedGroups(expandAllForShare())
    await new Promise((r) => setTimeout(r, 60)) // let the expand re-render before capture
    try {
      await run()
    } catch (e) {
      setToast(`${e?.message || 'Something went wrong.'} If this keeps happening, try opening this in a regular browser tab.`)
    } finally {
      setExpandedGroups(prevExpanded)
      setBusy('')
    }
  }
  const handleDownload = withExpandedCapture('download', async () => {
    const dataUrl = await captureElementAsJPG(printRef.current)
    downloadDataUrl(dataUrl, `Stock-in-Hand-${asOnDate}.jpg`)
  })
  const handleShareWhatsApp = async () => {
    setBusy('whatsapp')
    setToast('')
    const win = window.open('', '_blank')
    const prevExpanded = expandedGroups
    setExpandedGroups(expandAllForShare())
    await new Promise((r) => setTimeout(r, 60))
    try {
      const dataUrl = await captureElementAsJPG(printRef.current)
      const result = await shareJPGOnWhatsApp(dataUrl, `Stock-in-Hand-${asOnDate}.jpg`, `Stock-in-Hand as on ${fmtDateDMY(asOnDate)}`, win)
      if (result === 'fallback') setToast("Your browser can't attach the image automatically — it's downloaded, so just attach it in the WhatsApp chat that opened.")
    } catch (e) {
      win?.close()
      setToast(`${e?.message || 'Something went wrong.'} If this keeps happening, try opening this in a regular browser tab.`)
    } finally {
      setExpandedGroups(prevExpanded)
      setBusy('')
    }
  }
  const handleShareEmail = async () => {
    setBusy('email')
    setToast('')
    const win = window.open('', '_blank')
    const prevExpanded = expandedGroups
    setExpandedGroups(expandAllForShare())
    await new Promise((r) => setTimeout(r, 60))
    try {
      const dataUrl = await captureElementAsJPG(printRef.current)
      const result = await shareFileByEmail(dataUrl, `Stock-in-Hand-${asOnDate}.jpg`, 'image/jpeg', `Stock-in-Hand as on ${fmtDateDMY(asOnDate)}`, `Stock-in-Hand report as on ${fmtDateDMY(asOnDate)}.`, win)
      if (result === 'fallback') setToast('The image is downloaded — attach it to the email draft that opened.')
    } catch (e) {
      win?.close()
      setToast(`${e?.message || 'Something went wrong.'} If this keeps happening, try opening this in a regular browser tab.`)
    } finally {
      setExpandedGroups(prevExpanded)
      setBusy('')
    }
  }
  const handleExportCSV = () => {
    const headers = ['Weaver', 'Yarn Quality', 'Colour', 'Stock (kg)']
    const csvRows = []
    rows.forEach(({ weaver, groups }) => {
      groups.forEach((g) => {
        g.colours.forEach((c) => {
          csvRows.push([weaver.name, g.yarnTypeName, c.colourName, fmt(c.stockKg)])
        })
      })
    })
    downloadCSV(`Stock-in-Hand-${asOnDate}.csv`, headers, csvRows)
  }

  const openLedger = (weaverId, yarnTypeId, colourId, yarnTypeName, colourName) =>
    setLedger(
      buildColourLedger({
        ledgerRows,
        requirementRows: currentFYRequirementRows,
        issuesInFY: currentFYIssues,
        issueItems: allIssueItems,
        weaverFilter: weaverId,
        currentFY,
        yarnTypeId,
        colourId,
        yarnTypeName,
        colourName,
        reportDate: asOnDate,
      })
    )

  if (allRequirementRows === null) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3 print:hidden">
        <Header title="Stock-in-Hand" subtitle="Yarn issued beyond what's required, as on a chosen date — yarn+colour specific, weaver-wise." />
        <div className="flex gap-2 flex-wrap">
          <Btn variant="ghost" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </Btn>
          <Btn variant="ghost" onClick={handleExportCSV}>
            <FileText size={14} /> Export CSV
          </Btn>
          <Btn variant="ghost" onClick={handleDownload} disabled={busy === 'download'}>
            {busy === 'download' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download JPG
          </Btn>
          <Btn variant="ghost" onClick={handleShareEmail} disabled={busy === 'email'}>
            {busy === 'email' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Share on Email
          </Btn>
          <Btn onClick={handleShareWhatsApp} disabled={busy === 'whatsapp'}>
            {busy === 'whatsapp' ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Share on WhatsApp
          </Btn>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-5 print:hidden">
        <div className="relative max-w-xs flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search weaver, yarn, colour…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <Select value={weaverFilter} onChange={(e) => setWeaverFilter(e.target.value)} className="max-w-[220px]">
          <option value="">All weavers</option>
          {weavers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
        <Input type="date" value={asOnDate} onChange={(e) => setAsOnDate(e.target.value)} className="max-w-[170px]" />
      </div>
      {toast && <div className="text-xs mb-3 text-[#0D9488] print:hidden">{toast}</div>}

      <div ref={printRef} className="print-area bg-white">
        <div className="mb-4">
          <div style={{ fontFamily: 'var(--font-wordmark)', color: '#1C1917' }} className="text-xl">
            SOUTH HANDLOOMS
          </div>
          <div className="text-sm font-semibold text-stone-700 mt-1">Stock-in-Hand — as on {fmtDateDMY(asOnDate)}</div>
        </div>

        {rows.length === 0 ? (
          <Card>
            <Empty icon={Warehouse} title="No stock in hand" hint="No weaver has been issued more yarn than required, as on this date." />
          </Card>
        ) : visibleRows.length === 0 ? (
          <Card>
            <Empty icon={Search} title="No matches" hint="Try a different search term." />
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {visibleRows.map(({ weaver, groups, totalKg }) => (
              <Card key={weaver.id} className="overflow-hidden">
                <div className="px-4 py-2.5 border-b border-stone-200 flex items-center justify-between">
                  <span className="text-sm font-semibold text-stone-800">{weaver.name}</span>
                  <span className="text-sm font-semibold font-mono" style={{ color: '#16A34A' }}>
                    {fmt(totalKg)} kg
                  </span>
                </div>
                <div className="divide-y divide-stone-100">
                  {groups.map((g) => {
                    const key = `${weaver.id}|${g.yarnTypeName}`
                    const expanded = !!expandedGroups[key]
                    return (
                      <div key={g.yarnTypeName}>
                        <div className="flex items-center justify-between px-4 py-2 cursor-pointer select-none hover:bg-stone-50" onClick={() => toggleGroup(key)}>
                          <div className="flex items-center gap-2">
                            {expanded ? <ChevronDown size={14} className="text-stone-400" /> : <ChevronRight size={14} className="text-stone-400" />}
                            <span className="text-sm font-medium text-stone-800">{g.yarnTypeName}</span>
                          </div>
                          <span className="text-sm font-semibold font-mono" style={{ color: '#16A34A' }}>
                            {fmt(g.subtotalKg)} kg
                          </span>
                        </div>
                        {expanded && (
                          <table className="w-full text-sm" style={{ backgroundColor: '#FAFAF9' }}>
                            <tbody>
                              {g.colours.map((c, i) => (
                                <tr
                                  key={i}
                                  className="border-t border-stone-200 cursor-pointer hover:bg-stone-100"
                                  onClick={() => openLedger(weaver.id, c.yarnTypeId, c.colourId, g.yarnTypeName, c.colourName)}
                                >
                                  <td className="px-4 pl-9 py-1 text-stone-700 underline decoration-dotted decoration-stone-300">{c.colourName}</td>
                                  <td className="px-4 py-1 text-right font-mono font-medium" style={{ color: '#16A34A' }}>
                                    {fmt(c.stockKg)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>
            ))}
            <div className="flex justify-end px-2">
              <span className="text-sm font-semibold text-stone-700">
                Grand total: <span className="font-mono" style={{ color: '#16A34A' }}>{fmt(grandTotal)} kg</span>
              </span>
            </div>
          </div>
        )}
      </div>
      {ledger && <ColourLedgerModal ledger={ledger} onClose={() => setLedger(null)} />}
    </div>
  )
}
