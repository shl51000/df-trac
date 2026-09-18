import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, X, Trash2, Search, BookOpen } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { fmt, fmtDateDMY } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { Card, Label, Input, Select, Btn, Empty, Header, IconBtn, ConfirmBar } from '../../components/ui'

const DEFAULT_AS_OF = '2026-04-01'

export default function OpeningBalance() {
  const { isAdmin } = useAuth()
  const [weavers, setWeavers] = useState([])
  const [yarnTypes, setYarnTypes] = useState([]) // each with .colours
  const [rows, setRows] = useState(null)

  const [weaverId, setWeaverId] = useState('')
  const [yarnTypeId, setYarnTypeId] = useState('')
  const [colourId, setColourId] = useState('')
  const [asOfDate, setAsOfDate] = useState(DEFAULT_AS_OF)
  const [requiredKg, setRequiredKg] = useState('')
  const [excessKg, setExcessKg] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [query, setQuery] = useState('')

  const load = async () => {
    const { data } = await supabase.from('yarn_opening_balances').select('*').order('created_at')
    setRows(data ?? [])
  }
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
    load()
  }, [])

  const weaversById = useMemo(() => Object.fromEntries(weavers.map((w) => [w.id, w])), [weavers])
  const yarnTypesById = useMemo(() => Object.fromEntries(yarnTypes.map((y) => [y.id, y])), [yarnTypes])
  const coloursById = useMemo(() => Object.fromEntries(yarnTypes.flatMap((y) => y.colours.map((c) => [c.id, c]))), [yarnTypes])
  const selectedYarnType = yarnTypesById[yarnTypeId]

  const cancelEdit = () => {
    setEditingId(null)
    setWeaverId('')
    setYarnTypeId('')
    setColourId('')
    setAsOfDate(DEFAULT_AS_OF)
    setRequiredKg('')
    setExcessKg('')
    setError('')
  }

  const startEdit = (r) => {
    setEditingId(r.id)
    setWeaverId(r.weaver_id)
    setYarnTypeId(r.yarn_type_id)
    setColourId(r.colour_id)
    setAsOfDate(r.as_of_date)
    setRequiredKg(r.required_kg > 0 ? String(r.required_kg) : '')
    setExcessKg(r.excess_kg > 0 ? String(r.excess_kg) : '')
    setError('')
  }

  const submit = async () => {
    if (!weaverId) return setError('Select a weaver.')
    if (!yarnTypeId) return setError('Select a yarn quality.')
    if (!colourId) return setError('Select a colour.')
    if (!asOfDate) return setError('As-of date is required.')
    const req = Number(requiredKg) || 0
    const exc = Number(excessKg) || 0
    if (req > 0 && exc > 0) return setError('Enter either Yarn Required or Excess Yarn for this colour, not both.')
    if (req <= 0 && exc <= 0) return setError('Enter a Yarn Required or Excess Yarn amount greater than zero.')

    const payload = { weaver_id: weaverId, yarn_type_id: yarnTypeId, colour_id: colourId, as_of_date: asOfDate, required_kg: req, excess_kg: exc }
    const { error } = editingId
      ? await supabase.from('yarn_opening_balances').update(payload).eq('id', editingId)
      : await supabase.from('yarn_opening_balances').insert(payload)
    if (error) {
      setError(friendlyError(error, { onDuplicate: 'An opening balance already exists for this weaver + yarn + colour — edit that entry instead.' }))
      return
    }
    cancelEdit()
    load()
  }

  const remove = async (id) => {
    const { error } = await supabase.from('yarn_opening_balances').delete().eq('id', id)
    setConfirmDeleteId(null)
    if (error) {
      setError(friendlyError(error))
      return
    }
    load()
  }

  const grouped = useMemo(() => {
    if (!rows) return []
    const byWeaver = {}
    rows.forEach((r) => {
      const w = weaversById[r.weaver_id]
      const yt = yarnTypesById[r.yarn_type_id]
      const col = coloursById[r.colour_id]
      if (!w || !yt || !col) return
      ;(byWeaver[w.id] ??= { weaver: w, items: [] }).items.push({ ...r, yarnTypeName: yt.name, colourName: col.colour_name })
    })
    return Object.values(byWeaver)
      .map((g) => ({ ...g, items: g.items.sort((a, b) => a.yarnTypeName.localeCompare(b.yarnTypeName) || a.colourName.localeCompare(b.colourName)) }))
      .sort((a, b) => a.weaver.name.localeCompare(b.weaver.name))
  }, [rows, weaversById, yarnTypesById, coloursById])

  const visibleGroups = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return grouped
    return grouped
      .map((g) => {
        if (g.weaver.name.toLowerCase().includes(q)) return g
        return { ...g, items: g.items.filter((it) => it.yarnTypeName.toLowerCase().includes(q) || it.colourName.toLowerCase().includes(q)) }
      })
      .filter((g) => g.items.length > 0)
  }, [grouped, query])

  if (rows === null) return null

  return (
    <div>
      <Header
        title="Opening Balance"
        subtitle="One-time starting figures as on go-live (1 Apr 2026) for yarn already owed to, or already excess with, a weaver before Production Orders/Yarn Issue existed in this system. Carried automatically into that weaver's Yarn Required and Stock-in-Hand from this point on."
      />

      <Card className="p-5 max-w-2xl mb-6">
        <Label>{editingId ? 'Edit opening balance' : 'Add opening balance'}</Label>
        <div className="grid gap-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label>Weaver</Label>
              <Select value={weaverId} onChange={(e) => { setWeaverId(e.target.value); setError('') }}>
                <option value="">Select…</option>
                {weavers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Yarn quality</Label>
              <Select
                value={yarnTypeId}
                onChange={(e) => {
                  setYarnTypeId(e.target.value)
                  setColourId('')
                  setError('')
                }}
              >
                <option value="">Select…</option>
                {yarnTypes.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Colour</Label>
              <Select value={colourId} onChange={(e) => { setColourId(e.target.value); setError('') }} disabled={!selectedYarnType}>
                <option value="">{selectedYarnType ? 'Select…' : 'Pick yarn first'}</option>
                {(selectedYarnType?.colours || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.colour_name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <Label>As of date</Label>
              <Input type="date" value={asOfDate} onChange={(e) => { setAsOfDate(e.target.value); setError('') }} />
            </div>
            <div>
              <Label>Yarn Required (kg)</Label>
              <Input
                placeholder="0"
                value={requiredKg}
                onChange={(e) => {
                  setRequiredKg(e.target.value)
                  if (e.target.value) setExcessKg('')
                  setError('')
                }}
              />
            </div>
            <div>
              <Label>Excess Yarn (kg)</Label>
              <Input
                placeholder="0"
                value={excessKg}
                onChange={(e) => {
                  setExcessKg(e.target.value)
                  if (e.target.value) setRequiredKg('')
                  setError('')
                }}
              />
            </div>
          </div>
        </div>
        {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
        <div className="pt-4 mt-1 border-t border-stone-200 flex gap-2">
          <Btn onClick={submit}>
            {editingId ? <Pencil size={15} /> : <Plus size={15} />} {editingId ? 'Update' : 'Add'} opening balance
          </Btn>
          {editingId && (
            <Btn variant="ghost" onClick={cancelEdit}>
              <X size={15} /> Cancel
            </Btn>
          )}
        </div>
      </Card>

      {rows.length > 0 && (
        <div className="relative max-w-sm mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <Input placeholder="Search weaver, yarn or colour…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <Empty icon={BookOpen} title="No opening balances yet" hint="Add each weaver's pre-existing Yarn Required or Excess Yarn above, as on your go-live date." />
        </Card>
      ) : visibleGroups.length === 0 ? (
        <Card>
          <Empty icon={Search} title="No matches" hint="Try a different search term." />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {visibleGroups.map((g) => (
            <Card key={g.weaver.id} className="overflow-hidden">
              <div className="px-4 py-2.5 border-b border-stone-200">
                <span className="text-sm font-semibold text-stone-800">{g.weaver.name}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-stone-400 text-xs">
                      <th className="text-left font-semibold px-4 py-1.5">Yarn</th>
                      <th className="text-left font-semibold px-2 py-1.5">Colour</th>
                      <th className="text-left font-semibold px-2 py-1.5">As of</th>
                      <th className="text-right font-semibold px-2 py-1.5">Required</th>
                      <th className="text-right font-semibold px-2 py-1.5">Excess</th>
                      <th className="w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((it) => (
                      <tr key={it.id} className="border-t border-stone-100">
                        <td className="px-4 py-1.5 text-stone-800">{it.yarnTypeName}</td>
                        <td className="px-2 py-1.5 text-stone-800">{it.colourName}</td>
                        <td className="px-2 py-1.5 text-stone-500">{fmtDateDMY(it.as_of_date)}</td>
                        <td className="px-2 py-1.5 text-right font-mono font-medium" style={{ color: '#DC2626' }}>
                          {it.required_kg > 0 ? fmt(it.required_kg) : ''}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-medium" style={{ color: '#16A34A' }}>
                          {it.excess_kg > 0 ? fmt(it.excess_kg) : ''}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center justify-end gap-0.5">
                            <IconBtn title="Edit" onClick={() => startEdit(it)}>
                              <Pencil size={13} />
                            </IconBtn>
                            {isAdmin && (
                              <IconBtn title="Delete" danger onClick={() => setConfirmDeleteId(it.id)}>
                                <Trash2 size={13} />
                              </IconBtn>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {confirmDeleteId && g.items.some((it) => it.id === confirmDeleteId) && (
                <div className="px-4 pb-3 pt-1">
                  <ConfirmBar
                    text="Delete this opening balance?"
                    onConfirm={() => remove(confirmDeleteId)}
                    onCancel={() => setConfirmDeleteId(null)}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
