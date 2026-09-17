import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, ArrowUpDown, Pencil, Trash2, Image as ImageIcon, Grid3x3 } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { useAuth } from '../../context/AuthContext'
import { Card, Input, Btn, Empty, Header, Badge } from '../../components/ui'
import SheetViewerModal from '../../components/SheetViewerModal'
import NewDesignFlow from './NewDesignFlow'
import EditDesignForm from './EditDesignForm'

const DESIGN_SORTS = {
  newest: { label: 'Newest first', fn: (a, b) => b.created_at.localeCompare(a.created_at) },
  oldest: { label: 'Oldest first', fn: (a, b) => a.created_at.localeCompare(b.created_at) },
  designAsc: { label: 'Design No (A–Z)', fn: (a, b) => a.design_no.localeCompare(b.design_no) },
  pickAsc: { label: 'Pick (low–high)', fn: (a, b) => parseFloat(a.pick) - parseFloat(b.pick) },
}

export default function DesignLibrary() {
  const { isAdmin } = useAuth()
  const [view, setView] = useState('list') // "list" | "new" | "edit"
  const [designs, setDesigns] = useState(null)
  const [editingDesign, setEditingDesign] = useState(null)
  const [viewingSheetId, setViewingSheetId] = useState(null)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState('newest')

  const load = async () => {
    const { data } = await supabase.from('designs').select('*').order('created_at', { ascending: false })
    setDesigns(data ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  const visibleDesigns = useMemo(() => {
    if (!designs) return []
    const q = query.trim().toLowerCase()
    const filtered = q ? designs.filter((d) => d.label.toLowerCase().includes(q) || d.design_no.toLowerCase().includes(q)) : designs
    return [...filtered].sort(DESIGN_SORTS[sortKey].fn)
  }, [designs, query, sortKey])

  const startEdit = async (id) => {
    const { data } = await supabase.from('design_feeders').select('*').eq('design_id', id).order('feeder_no')
    const design = designs.find((d) => d.id === id)
    setEditingDesign({ ...design, feeders: data ?? [] })
    setView('edit')
  }

  const removeDesign = async (id) => {
    const { error } = await supabase.from('designs').delete().eq('id', id)
    if (error) return friendlyError(error, { onInUse: "Used in a Production Order — can't delete." })
    load()
    return null
  }

  if (designs === null) return null

  if (view === 'new') {
    return (
      <NewDesignFlow
        existingDesigns={designs}
        onCancel={() => setView('list')}
        onSaved={() => {
          setView('list')
          load()
        }}
      />
    )
  }

  if (view === 'edit' && editingDesign) {
    return (
      <EditDesignForm
        design={editingDesign}
        existingDesigns={designs}
        onCancel={() => {
          setView('list')
          setEditingDesign(null)
        }}
        onSaved={() => {
          setView('list')
          setEditingDesign(null)
          load()
        }}
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <Header title="Design Library" subtitle="Every design spec sheet, one record per base pick value." />
        <Btn onClick={() => setView('new')}>
          <Plus size={15} /> New Design
        </Btn>
      </div>

      {designs.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <div className="relative max-w-xs flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="Filter by design no…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          </div>
          <div className="relative">
            <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="rounded border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none"
            >
              {Object.entries(DESIGN_SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <DesignsList
        designs={visibleDesigns}
        onDelete={removeDesign}
        onViewSheet={setViewingSheetId}
        onEdit={startEdit}
        canDelete={isAdmin}
        emptyHint={designs.length === 0 ? 'Add one with "New Design" — upload a spec sheet or enter it manually.' : 'No designs match that filter.'}
      />

      {viewingSheetId && <SheetViewerModal sheetId={viewingSheetId} onClose={() => setViewingSheetId(null)} />}
    </div>
  )
}

function DesignsList({ designs, onDelete, onViewSheet, onEdit, canDelete, emptyHint }) {
  const [confirmId, setConfirmId] = useState(null)
  const [error, setError] = useState('')

  if (designs.length === 0) {
    return (
      <Card>
        <Empty icon={Grid3x3} title="No designs found" hint={emptyHint} />
      </Card>
    )
  }

  const doDelete = async (id) => {
    const err = await onDelete(id)
    setConfirmId(null)
    if (err) setError(err)
  }

  return (
    <div>
      {error && <div className="text-xs mb-2 text-[#0D9488]">{error}</div>}
      <div className="flex flex-col gap-2">
        {designs.map((d) => (
          <Card key={d.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-y-2 gap-x-4">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-sm font-semibold text-stone-800">{d.label}</span>
              <span style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }} className="px-2.5 py-0.5 rounded-full text-xs font-semibold">
                {d.pick}
              </span>
              {!d.is_active && <Badge tone="neutral">Inactive</Badge>}
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              {d.sheet_id && (
                <button onClick={() => onViewSheet(d.sheet_id)} className="flex items-center gap-1 text-[#0D9488] hover:underline">
                  <ImageIcon size={13} /> View Sheet
                </button>
              )}
              <button onClick={() => onEdit(d.id)} className="flex items-center gap-1 text-stone-500 hover:text-stone-700">
                <Pencil size={13} /> Edit
              </button>
              {canDelete &&
                (confirmId === d.id ? (
                  <span className="flex items-center gap-2">
                    <button onClick={() => doDelete(d.id)} className="font-semibold underline text-[#0D9488]">
                      Delete
                    </button>
                    <button onClick={() => setConfirmId(null)} className="font-semibold text-stone-500">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmId(d.id)} className="flex items-center gap-1 text-stone-400 hover:text-[#0D9488]">
                    <Trash2 size={13} /> Delete
                  </button>
                ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
