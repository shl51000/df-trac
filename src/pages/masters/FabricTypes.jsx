import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, X, Trash2, Boxes, Search, ArrowUpDown, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { useAuth } from '../../context/AuthContext'
import { Card, Label, Input, Select, Btn, Empty, Header, IconBtn, Badge } from '../../components/ui'

const MEASURING_TERMS = ['Mts', 'Pcs']

// A Design No's leading letters (e.g. "MS" in "MS-147") are matched
// against a Fabric Type's Code — mirrors getDesignPrefix in the prototype.
const getDesignPrefix = (designNo) => (String(designNo || '').match(/^[A-Za-z]+/) || [''])[0]

const SORTS = {
  codeAsc: { label: 'Code (A–Z)', fn: (a, b) => a.code.localeCompare(b.code) },
  nameAsc: { label: 'Name (A–Z)', fn: (a, b) => a.name.localeCompare(b.name) },
}

export default function FabricTypes() {
  const { isAdmin } = useAuth()
  const [fabricTypes, setFabricTypes] = useState(null)
  const [designNos, setDesignNos] = useState([]) // for the "in use" check, same as the prototype

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [measuringTerm, setMeasuringTerm] = useState(MEASURING_TERMS[0])
  const [editingId, setEditingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState('codeAsc')
  const [showInactive, setShowInactive] = useState(false)

  const load = async () => {
    const [{ data: fts }, { data: designs }] = await Promise.all([
      supabase.from('fabric_types').select('*'),
      supabase.from('designs').select('design_no'),
    ])
    setFabricTypes(fts ?? [])
    setDesignNos((designs ?? []).map((d) => d.design_no))
  }
  useEffect(() => {
    load()
  }, [])

  const isInUse = (code) => designNos.some((no) => getDesignPrefix(no).toUpperCase() === code.trim().toUpperCase())

  const startEdit = (f) => {
    setEditingId(f.id)
    setCode(f.code)
    setName(f.name)
    setMeasuringTerm(f.measuring_term)
    setError('')
  }
  const cancelEdit = () => {
    setEditingId(null)
    setCode('')
    setName('')
    setMeasuringTerm(MEASURING_TERMS[0])
    setError('')
  }

  const submit = async () => {
    const c = code.trim()
    const n = name.trim()
    if (!c) {
      setError('Code is required.')
      return
    }
    if (!n) {
      setError('Name is required.')
      return
    }
    const payload = { code: c, name: n, measuring_term: measuringTerm }
    const { error } = editingId
      ? await supabase.from('fabric_types').update(payload).eq('id', editingId)
      : await supabase.from('fabric_types').insert(payload)
    if (error) {
      setError(friendlyError(error, { onDuplicate: `Code "${c.toUpperCase()}" already exists.` }))
      return
    }
    cancelEdit()
    load()
  }

  const removeFabricType = async (id) => {
    const { error } = await supabase.from('fabric_types').delete().eq('id', id)
    setConfirmDeleteId(null)
    if (error) {
      setError(friendlyError(error))
      return
    }
    load()
  }

  const toggleActive = async (f) => {
    await supabase.from('fabric_types').update({ is_active: !f.is_active }).eq('id', f.id)
    load()
  }

  const visible = useMemo(() => {
    if (!fabricTypes) return []
    const q = query.trim().toLowerCase()
    return fabricTypes
      .filter((f) => showInactive || f.is_active)
      .filter((f) => !q || f.code.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
      .sort(SORTS[sortKey].fn)
  }, [fabricTypes, query, sortKey, showInactive])

  if (fabricTypes === null) return null

  return (
    <div>
      <Header title="Fabric Types" subtitle="A Design No's leading letters (e.g. “MS”) are matched against a Fabric Type's Code to work out its unit — Mts or Pcs." />

      <Card className="p-5 max-w-lg mb-6">
        <Label>{editingId ? 'Edit fabric type' : 'Add fabric type'}</Label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label>Code</Label>
            <Input
              placeholder="e.g. DS"
              value={code}
              onChange={(e) => {
                setCode(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Name</Label>
            <Input
              placeholder="e.g. Material"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Measuring term</Label>
            <Select value={measuringTerm} onChange={(e) => setMeasuringTerm(e.target.value)}>
              {MEASURING_TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
        <div className="pt-4 mt-1 border-t border-stone-200 flex gap-2">
          <Btn onClick={submit}>
            {editingId ? <Pencil size={15} /> : <Plus size={15} />} {editingId ? 'Update' : 'Add'} fabric type
          </Btn>
          {editingId && (
            <Btn variant="ghost" onClick={cancelEdit}>
              <X size={15} /> Cancel
            </Btn>
          )}
        </div>
      </Card>

      {fabricTypes.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <div className="relative max-w-xs flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="Filter by code or name…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          </div>
          <div className="relative">
            <ArrowUpDown size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="rounded border border-stone-300 bg-white pl-7 pr-3 py-2 text-sm text-stone-700 outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] appearance-none"
            >
              {Object.entries(SORTS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
      )}

      <Card>
        {fabricTypes.length === 0 ? (
          <Empty icon={Boxes} title="No fabric types yet" hint='Add one above — e.g. Code "DS", Name "Material", Mts.' />
        ) : visible.length === 0 ? (
          <Empty icon={Search} title="No matches" hint="Try a different search term, or show inactive types." />
        ) : (
          <div className="divide-y divide-stone-100">
            {visible.map((f) => {
              const inUse = isInUse(f.code)
              return (
                <div key={f.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-sm font-bold text-stone-800">{f.code}</span>
                    <span className="text-sm text-stone-800">{f.name}</span>
                    <Badge tone="neutral">{f.measuring_term}</Badge>
                    {!f.is_active && <Badge tone="neutral">Inactive</Badge>}
                  </div>
                  <div className="flex items-center gap-1">
                    <IconBtn title={f.is_active ? 'Mark inactive' : 'Mark active'} onClick={() => toggleActive(f)}>
                      <EyeOff size={14} />
                    </IconBtn>
                    <IconBtn title="Edit" onClick={() => startEdit(f)}>
                      <Pencil size={14} />
                    </IconBtn>
                    {isAdmin &&
                      (confirmDeleteId === f.id ? (
                        <div className="flex items-center gap-2 text-xs">
                          <button onClick={() => removeFabricType(f.id)} className="font-semibold underline text-[#0D9488]">
                            Delete
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)} className="font-semibold text-stone-500">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <IconBtn
                          title={inUse ? "Used by a Design No — can't delete" : 'Delete'}
                          danger
                          onClick={() => setConfirmDeleteId(f.id)}
                          disabled={inUse}
                        >
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
    </div>
  )
}
