import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, X, Trash2, ChevronDown, ChevronRight, Palette, Boxes, Search, Check, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { stripDenierSuffix, withDenierSuffix } from '../../lib/suffix'
import { useAuth } from '../../context/AuthContext'
import { Card, Label, Input, SuffixedInput, Btn, Empty, Header, IconBtn, Badge, ConfirmBar } from '../../components/ui'

export default function YarnTypes() {
  const { isAdmin } = useAuth()
  const [yarnTypes, setYarnTypes] = useState(null) // [{ ...row, colours: [...] }]

  const [name, setName] = useState('')
  const [denier, setDenier] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [query, setQuery] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [error, setError] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const load = async () => {
    const [{ data: types }, { data: colours }] = await Promise.all([
      supabase.from('yarn_types').select('*').order('name'),
      supabase.from('yarn_colours').select('*').order('colour_name'),
    ])
    const withColours = (types ?? []).map((y) => ({ ...y, colours: (colours ?? []).filter((c) => c.yarn_type_id === y.id) }))
    setYarnTypes(withColours)
  }
  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    if (!yarnTypes) return []
    const q = query.trim().toLowerCase()
    return yarnTypes
      .filter((y) => showInactive || y.is_active)
      .filter(
        (y) =>
          !q ||
          y.name.toLowerCase().includes(q) ||
          String(y.denier).toLowerCase().includes(q) ||
          y.colours.some((c) => c.colour_name.toLowerCase().includes(q))
      )
  }, [yarnTypes, query, showInactive])

  const startEdit = (y) => {
    setEditingId(y.id)
    setName(y.name)
    setDenier(stripDenierSuffix(y.denier))
    setError('')
  }
  const cancelEdit = () => {
    setEditingId(null)
    setName('')
    setDenier('')
    setError('')
  }

  const submit = async () => {
    const n = name.trim()
    const dRaw = denier.trim()
    if (!n) {
      setError('Name of yarn is required.')
      return
    }
    if (!dRaw) {
      setError('Denier is required.')
      return
    }
    const d = withDenierSuffix(dRaw)
    const payload = { name: n, denier: d }
    const { error } = editingId
      ? await supabase.from('yarn_types').update(payload).eq('id', editingId)
      : await supabase.from('yarn_types').insert(payload)
    if (error) {
      setError(friendlyError(error, { onDuplicate: `${n} already exists as a yarn type.` }))
      return
    }
    cancelEdit()
    load()
  }

  const removeYarnType = async (id) => {
    const { error } = await supabase.from('yarn_types').delete().eq('id', id)
    setConfirmDeleteId(null)
    if (error) {
      setError(friendlyError(error, { onInUse: "Used in a Production Order — can't delete. Mark it inactive instead." }))
      return
    }
    load()
  }

  const toggleActive = async (y) => {
    await supabase.from('yarn_types').update({ is_active: !y.is_active }).eq('id', y.id)
    load()
  }

  const toggleExpand = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  if (yarnTypes === null) return null

  return (
    <div>
      <Header
        title="Yarn Library"
        subtitle="Define each yarn by name and denier, then add its colour subsets. Requirement, issue, and stock with the weaver will all be tracked at colour level under each yarn type."
      />

      <Card className="p-5 max-w-lg mb-6">
        <Label>{editingId ? 'Edit yarn type' : 'Add yarn type'}</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Name of yarn</Label>
            <Input
              placeholder="e.g. Viscose Filament"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Denier</Label>
            <SuffixedInput
              suffix="D"
              placeholder="e.g. 150"
              value={denier}
              onChange={(e) => {
                setDenier(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
          </div>
        </div>
        {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
        <div className="pt-4 mt-1 border-t border-stone-200 flex gap-2">
          <Btn onClick={submit}>
            {editingId ? <Pencil size={15} /> : <Plus size={15} />} {editingId ? 'Update' : 'Add'} yarn type
          </Btn>
          {editingId && (
            <Btn variant="ghost" onClick={cancelEdit}>
              <X size={15} /> Cancel
            </Btn>
          )}
        </div>
      </Card>

      {yarnTypes.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <div className="relative max-w-sm flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="Search yarn, denier or colour…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
      )}

      {yarnTypes.length === 0 ? (
        <Card>
          <Empty icon={Boxes} title="No yarn types yet" hint="Add your first yarn above — for example, Viscose Filament, 150D." />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <Empty icon={Search} title="No matches" hint="Try a different search term, or show inactive yarn types." />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((y) => (
            <YarnTypeCard
              key={y.id}
              yarnType={y}
              expanded={!!expanded[y.id]}
              onToggle={() => toggleExpand(y.id)}
              onEdit={() => startEdit(y)}
              onToggleActive={() => toggleActive(y)}
              onDeleteRequest={() => setConfirmDeleteId(y.id)}
              confirmingDelete={confirmDeleteId === y.id}
              onConfirmDelete={() => removeYarnType(y.id)}
              onCancelDelete={() => setConfirmDeleteId(null)}
              onColoursChanged={load}
              canDelete={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function YarnTypeCard({
  yarnType,
  expanded,
  onToggle,
  onEdit,
  onToggleActive,
  onDeleteRequest,
  confirmingDelete,
  onConfirmDelete,
  onCancelDelete,
  onColoursChanged,
  canDelete,
}) {
  const [colourName, setColourName] = useState('')
  const [editingColourId, setEditingColourId] = useState(null)
  const [colourError, setColourError] = useState('')
  const [confirmDeleteColourId, setConfirmDeleteColourId] = useState(null)

  const colours = yarnType.colours

  const startEditColour = (c) => {
    setEditingColourId(c.id)
    setColourName(c.colour_name)
    setColourError('')
  }
  const cancelEditColour = () => {
    setEditingColourId(null)
    setColourName('')
    setColourError('')
  }

  const submitColour = async () => {
    const c = colourName.trim()
    if (!c) {
      setColourError('Enter a colour name.')
      return
    }
    const { error } = editingColourId
      ? await supabase.from('yarn_colours').update({ colour_name: c }).eq('id', editingColourId)
      : await supabase.from('yarn_colours').insert({ yarn_type_id: yarnType.id, colour_name: c })
    if (error) {
      setColourError(friendlyError(error, { onDuplicate: `"${c}" already exists for this yarn.` }))
      return
    }
    cancelEditColour()
    onColoursChanged()
  }

  const removeColour = async (id) => {
    const { error } = await supabase.from('yarn_colours').delete().eq('id', id)
    setConfirmDeleteColourId(null)
    if (error) {
      setColourError(friendlyError(error, { onInUse: "Used in a Production Order — can't delete." }))
      return
    }
    onColoursChanged()
  }

  return (
    <Card>
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none" onClick={onToggle}>
        <div className="flex items-center gap-2.5">
          {expanded ? <ChevronDown size={16} className="text-stone-400" /> : <ChevronRight size={16} className="text-stone-400" />}
          <span className="text-sm font-semibold text-stone-800">{yarnType.name}</span>
          <Badge tone="neutral">
            {colours.length} colour{colours.length === 1 ? '' : 's'}
          </Badge>
          {!yarnType.is_active && <Badge tone="neutral">Inactive</Badge>}
        </div>
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <IconBtn title={yarnType.is_active ? 'Mark inactive' : 'Mark active'} onClick={onToggleActive}>
            <EyeOff size={14} />
          </IconBtn>
          <IconBtn title="Edit yarn type" onClick={onEdit}>
            <Pencil size={14} />
          </IconBtn>
          {canDelete && (
            <IconBtn title="Delete yarn type" danger onClick={onDeleteRequest}>
              <Trash2 size={14} />
            </IconBtn>
          )}
        </div>
      </div>

      {confirmingDelete && (
        <div className="px-4 pb-3">
          <ConfirmBar
            text={colours.length > 0 ? `Delete "${yarnType.name}" and all ${colours.length} colour(s) under it?` : `Delete "${yarnType.name}"?`}
            onConfirm={onConfirmDelete}
            onCancel={onCancelDelete}
          />
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-4 border-t border-stone-200">
          <div className="pt-3 flex items-center gap-2 text-stone-500">
            <Palette size={13} />
            <span className="text-xs font-medium">Colours</span>
          </div>

          {colours.length > 0 && (
            <div className="mt-2 divide-y divide-stone-100">
              {colours.map((c) => (
                <div key={c.id} className="py-2 flex items-center justify-between">
                  <span className="text-sm text-stone-800">{c.colour_name}</span>
                  <div className="flex items-center gap-1">
                    <IconBtn title="Edit" onClick={() => startEditColour(c)}>
                      <Pencil size={13} />
                    </IconBtn>
                    {canDelete &&
                      (confirmDeleteColourId === c.id ? (
                        <div className="flex items-center gap-1 text-xs">
                          <button onClick={() => removeColour(c.id)} className="font-semibold underline text-[#0D9488]">
                            Delete
                          </button>
                          <button onClick={() => setConfirmDeleteColourId(null)} className="font-semibold text-stone-500">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <IconBtn title="Delete" danger onClick={() => setConfirmDeleteColourId(c.id)}>
                          <Trash2 size={13} />
                        </IconBtn>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <Label>Colour name</Label>
              <Input
                placeholder="e.g. Maroon"
                value={colourName}
                onChange={(e) => {
                  setColourName(e.target.value)
                  setColourError('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitColour()
                }}
              />
            </div>
            <Btn onClick={submitColour}>
              {editingColourId ? <Check size={14} /> : <Plus size={14} />} {editingColourId ? 'Update' : 'Add'}
            </Btn>
            {editingColourId && (
              <Btn variant="ghost" onClick={cancelEditColour}>
                <X size={14} />
              </Btn>
            )}
          </div>
          {colourError && <div className="text-xs mt-1.5 text-[#0D9488]">{colourError}</div>}
        </div>
      )}
    </Card>
  )
}
