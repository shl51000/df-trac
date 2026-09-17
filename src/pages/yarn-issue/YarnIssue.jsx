import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, ArrowUpDown, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { getFY } from '../../lib/fy'
import { ISSUE_SORTS, issueMatchesQuery } from '../../lib/issueHelpers'
import { useAuth } from '../../context/AuthContext'
import { useFY } from '../../context/FYContext'
import { Input, Select, Btn, Header } from '../../components/ui'
import YarnIssueList from './YarnIssueList'
import NewYarnIssueForm from './NewYarnIssueForm'
import IssueSlip from './IssueSlip'

async function fetchIssueItems(issueId) {
  const { data } = await supabase.from('yarn_issue_items').select('*').eq('yarn_issue_id', issueId).order('sl')
  return data ?? []
}

export default function YarnIssue() {
  const { isAdmin } = useAuth()
  const { currentFY, isClosed: fyLocked } = useFY()
  const [view, setView] = useState('list') // "list" | "new" | "edit" | "slip"
  const [allIssues, setAllIssues] = useState(null)
  const [weavers, setWeavers] = useState([])
  const [editingIssue, setEditingIssue] = useState(null)
  const [slipIssue, setSlipIssue] = useState(null)

  const [weaverFilter, setWeaverFilter] = useState('')
  const [sortKey, setSortKey] = useState('dateNewest')
  const [query, setQuery] = useState('')

  const load = async () => {
    const [{ data: issues }, { data: w }] = await Promise.all([
      supabase.from('yarn_issues').select('*').order('issue_date', { ascending: false }),
      supabase.from('weavers').select('*').eq('is_active', true).order('name'),
    ])
    setAllIssues(issues ?? [])
    setWeavers(w ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  const issues = useMemo(() => (allIssues ?? []).filter((i) => getFY(i.issue_date) === currentFY), [allIssues, currentFY])

  const filteredSorted = useMemo(() => {
    let list = weaverFilter ? issues.filter((i) => i.weaver_id === weaverFilter) : issues
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((i) => issueMatchesQuery(i, q))
    return [...list].sort(ISSUE_SORTS[sortKey].fn)
  }, [issues, weaverFilter, sortKey, query])

  const openSlip = async (id) => {
    const { data: issue } = await supabase.from('yarn_issues').select('*').eq('id', id).single()
    const items = await fetchIssueItems(id)
    setSlipIssue({ ...issue, items })
    setView('slip')
  }
  const openEdit = async (id) => {
    const { data: issue } = await supabase.from('yarn_issues').select('*').eq('id', id).single()
    const items = await fetchIssueItems(id)
    setEditingIssue({ ...issue, items })
    setView('edit')
  }
  const removeIssue = async (id) => {
    const { error } = await supabase.from('yarn_issues').delete().eq('id', id)
    if (error) return friendlyError(error)
    load()
    return null
  }

  if (allIssues === null) return null

  if (view === 'new') {
    return (
      <NewYarnIssueForm
        existingIssues={issues}
        onCancel={() => setView('list')}
        onSaved={(id) => {
          load()
          openSlip(id)
        }}
      />
    )
  }
  if (view === 'edit' && editingIssue) {
    return (
      <NewYarnIssueForm
        editingIssue={editingIssue}
        existingIssues={issues}
        onCancel={() => {
          setView('list')
          setEditingIssue(null)
        }}
        onSaved={(id) => {
          setEditingIssue(null)
          load()
          openSlip(id)
        }}
      />
    )
  }
  if (view === 'slip' && slipIssue) {
    return (
      <IssueSlip
        issue={slipIssue}
        onBack={() => {
          setView('list')
          setSlipIssue(null)
        }}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <Header title="Yarn Issue" subtitle="Yarn issued to a weaver — items, rate, and dispatch details." />
        <Btn onClick={() => setView('new')} disabled={fyLocked}>
          <Plus size={15} /> New Issue
        </Btn>
      </div>
      {fyLocked && (
        <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 flex items-center gap-1.5">
          <Lock size={13} /> FY {currentFY} is closed — read-only. Switch to an open year from the sidebar to make changes.
        </div>
      )}

      {issues.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-5">
          <div className="relative max-w-xs flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="Search RMDC no, weaver…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
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
              {Object.entries(ISSUE_SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <YarnIssueList
        issues={filteredSorted}
        onDelete={removeIssue}
        onView={openSlip}
        onEdit={openEdit}
        canDelete={isAdmin && !fyLocked}
        canEdit={!fyLocked}
        emptyHint='Add one with "New Issue".'
      />
    </div>
  )
}
