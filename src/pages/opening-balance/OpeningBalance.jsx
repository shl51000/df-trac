import { useEffect, useMemo, useState } from 'react'
import { Trash2, Search, BookOpen, Save } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { fmt } from '../../lib/format'
import { withDenierSuffix } from '../../lib/suffix'
import { useAuth } from '../../context/AuthContext'
import { Card, Label, Input, Select, Btn, Empty, Header, IconBtn, AddBtn, ConfirmBar } from '../../components/ui'
import { QuickAddYarnTypeModal, QuickAddColourModal } from '../production-orders/QuickAddModals'

const DEFAULT_AS_OF = '2026-04-01'
const blankRow = () => ({ id: null, yarnTypeId: '', colourId: '', requiredKg: '', excessKg: '' })

export default function OpeningBalance() {
  const { isAdmin } = useAuth()
  const [weavers, setWeavers] = useState([])
  const [yarnTypes, setYarnTypes] = useState([]) // each with .colours
  const [rows, setRows] = useState(null)

  const [weaverId, setWeaverId] = useState('')
  const [asOfDate, setAsOfDate] = useState(DEFAULT_AS_OF)
  const [gridRows, setGridRows] = useState([])
  const [addModal, setAddModal] = useState(null) // { kind: 'yarn'|'colour', rowIdx, yarnTypeId? }
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [query, setQuery] = useState('')

  const load = async () => {
    const { data } = await supabase.from('yarn_opening_balances').select('*').order('created_at')
    setRows(data ?? [])
  }
  const loadMasters = async () => {
    const [{ data: yt }, { data: yc }] = await Promise.all([
      supabase.from('yarn_types').select('*').order('name'),
      supabase.from('yarn_colours').select('*'),
    ])
    setYarnTypes((yt ?? []).map((y) => ({ ...y, colours: (yc ?? []).filter((c) => c.yarn_type_id === y.id) })))
  }
  useEffect(() => {
    supabase
      .from('weavers')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setWeavers(data ?? []))
    loadMasters()
    load()
  }, [])

  const weaversById = useMemo(() => Object.fromEntries(weavers.map((w) => [w.id, w])), [weavers])
  const yarnTypesById = useMemo(() => Object.fromEntries(yarnTypes.map((y) => [y.id, y])), [yarnTypes])
  const coloursById = useMemo(() => Object.fromEntries(yarnTypes.flatMap((y) => y.colours.map((c) => [c.id, c]))), [yarnTypes])

  // Selecting a weaver loads their existing rows straight into the grid
  // for editing; picking a different weaver (or none) resets it to a
  // single blank row ready for entry.
  useEffect(() => {
    if (!weaverId || rows === null) {
      setGridRows(weaverId ? [blankRow()] : [])
      return
    }
    const existing = rows.filter((r) => r.weaver_id === weaverId)
    if (existing.length === 0) {
      setGridRows([blankRow()])
      setAsOfDate(DEFAULT_AS_OF)
      return
    }
    setGridRows(
      existing.map((r) => ({
        id: r.id,
        yarnTypeId: r.yarn_type_id,
        colourId: r.colour_id,
        requiredKg: r.required_kg > 0 ? String(r.required_kg) : '',
        excessKg: r.excess_kg > 0 ? String(r.excess_kg) : '',
      }))
    )
    setAsOfDate(existing[0].as_of_date)
  }, [weaverId, rows])

  const selectWeaver = (id) => {
    setWeaverId(id)
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const updateRow = (idx, patch) => setGridRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  const addGridRow = () => setGridRows((rs) => [...rs, blankRow()])
  const removeGridRow = async (idx) => {
    const row = gridRows[idx]
    if (!row.id) {
      setGridRows((rs) => rs.filter((_, i) => i !== idx))
      return
    }
    const { error } = await supabase.from('yarn_opening_balances').delete().eq('id', row.id)
    if (error) return setError(friendlyError(error))
    load()
  }

  const submit = async () => {
    if (!weaverId) return setError('Select a weaver.')
    if (!asOfDate) return setError('As-on date is required.')
    const seen = new Set()
    const toUpsert = []
    for (const r of gridRows) {
      const hasAny = r.yarnTypeId || r.colourId || r.requiredKg || r.excessKg
      if (!hasAny) continue
      if (!r.yarnTypeId) return setError('Select a yarn quality for every row.')
      if (!r.colourId) return setError('Select a colour for every row.')
      const req = Number(r.requiredKg) || 0
      const exc = Number(r.excessKg) || 0
      if (req > 0 && exc > 0) return setError('Enter either Yarn Required or Excess Yarn per row, not both.')
      if (req <= 0 && exc <= 0) return setError('Enter a Yarn Required or Excess Yarn amount for every row.')
      const key = `${r.yarnTypeId}|${r.colourId}`
      if (seen.has(key)) return setError('The same yarn + colour appears twice — combine them into one row.')
      seen.add(key)
      toUpsert.push({ weaver_id: weaverId, yarn_type_id: r.yarnTypeId, colour_id: r.colourId, as_of_date: asOfDate, required_kg: req, excess_kg: exc })
    }
    if (!toUpsert.length) return setError('Add at least one yarn + colour row.')

    setSaving(true)
    const { error } = await supabase.from('yarn_opening_balances').upsert(toUpsert, { onConflict: 'weaver_id,yarn_type_id,colour_id' })
    setSaving(false)
    if (error) {
      setError(friendlyError(error))
      return
    }
    setError('')
    load()
  }

  const createYarnType = async (name, denier) => {
    const dNorm = withDenierSuffix(denier)
    const dup = yarnTypes.some((y) => y.name.trim().toLowerCase() === name.toLowerCase())
    if (dup) return `${name} already exists as a yarn type.`
    const { data, error } = await supabase.from('yarn_types').insert({ name, denier: dNorm }).select().single()
    if (error) return friendlyError(error)
    await loadMasters()
    updateRow(addModal.rowIdx, { yarnTypeId: data.id, colourId: '' })
    setAddModal(null)
    return null
  }

  const createColour = async (name) => {
    const { data, error } = await supabase.from('yarn_colours').insert({ yarn_type_id: addModal.yarnTypeId, colour_name: name }).select().single()
    if (error) return friendlyError(error, { onDuplicate: `"${name}" already exists for this yarn.` })
    await loadMasters()
    updateRow(addModal.rowIdx, { colourId: data.id })
    setAddModal(null)
    return null
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
    const base = !q
      ? grouped
      : grouped
          .map((g) => {
            if (g.weaver.name.toLowerCase().includes(q)) return g
            return { ...g, items: g.items.filter((it) => it.yarnTypeName.toLowerCase().includes(q) || it.colourName.toLowerCase().includes(q)) }
          })
          .filter((g) => g.items.length > 0)
    return base.map((g) => ({
      ...g,
      subtotalRequired: g.items.reduce((s, it) => s + (Number(it.required_kg) || 0), 0),
      subtotalExcess: g.items.reduce((s, it) => s + (Number(it.excess_kg) || 0), 0),
    }))
  }, [grouped, query])
  const grandTotalRequired = visibleGroups.reduce((s, g) => s + g.subtotalRequired, 0)
  const grandTotalExcess = visibleGroups.reduce((s, g) => s + g.subtotalExcess, 0)

  if (rows === null) return null

  return (
    <div>
      <Header
        title="Opening Balance"
        subtitle="One-time starting figures as on go-live (1 Apr 2026) for yarn already owed to, or already excess with, a weaver before Production Orders/Yarn Issue existed in this system. Carried automatically into that weaver's Yarn Required and Stock-in-Hand from this point on."
      />

      <Card className="mb-6 overflow-hidden">
        <div className="p-4 border-b border-stone-200 grid sm:grid-cols-2 gap-3 max-w-lg">
          <div>
            <Label>Weaver Name</Label>
            <Select value={weaverId} onChange={(e) => selectWeaver(e.target.value)}>
              <option value="">Select…</option>
              {weavers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Date (as on)</Label>
            <Input type="date" value={asOfDate} onChange={(e) => { setAsOfDate(e.target.value); setError('') }} disabled={!weaverId} />
          </div>
        </div>

        {!weaverId ? (
          <div className="p-6 text-sm text-stone-400 text-center">Select a weaver above to enter or edit their opening balance.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-stone-400 text-xs">
                    <th className="text-left font-semibold px-4 py-1.5">Yarn Quality</th>
                    <th className="text-left font-semibold px-2 py-1.5">Colour</th>
                    <th className="text-right font-semibold px-2 py-1.5">Yarn Required</th>
                    <th className="text-right font-semibold px-2 py-1.5">Excess Yarn</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {gridRows.map((r, idx) => {
                    const yt = yarnTypesById[r.yarnTypeId]
                    const isExisting = !!r.id
                    return (
                      <tr key={idx} className="border-t border-stone-100">
                        <td className="px-4 py-1.5 min-w-[170px]">
                          {isExisting ? (
                            <span className="text-stone-800">{yt?.name}</span>
                          ) : (
                            <div className="flex gap-1.5">
                              <Select
                                value={r.yarnTypeId}
                                onChange={(e) => updateRow(idx, { yarnTypeId: e.target.value, colourId: '' })}
                              >
                                <option value="">Select…</option>
                                {yarnTypes.map((y) => (
                                  <option key={y.id} value={y.id}>
                                    {y.name}
                                  </option>
                                ))}
                              </Select>
                              <AddBtn title="Add yarn quality" onClick={() => setAddModal({ kind: 'yarn', rowIdx: idx })} />
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 min-w-[160px]">
                          {isExisting ? (
                            <span className="text-stone-800">{coloursById[r.colourId]?.colour_name}</span>
                          ) : (
                            <div className="flex gap-1.5">
                              <Select value={r.colourId} onChange={(e) => updateRow(idx, { colourId: e.target.value })} disabled={!yt}>
                                <option value="">{yt ? 'Select…' : 'Pick yarn first'}</option>
                                {(yt?.colours || []).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.colour_name}
                                  </option>
                                ))}
                              </Select>
                              <AddBtn
                                title="Add colour"
                                disabled={!yt}
                                onClick={() => setAddModal({ kind: 'colour', rowIdx: idx, yarnTypeId: r.yarnTypeId })}
                              />
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 w-28">
                          <Input
                            placeholder="0"
                            value={r.requiredKg}
                            onChange={(e) => updateRow(idx, { requiredKg: e.target.value, ...(e.target.value ? { excessKg: '' } : {}) })}
                            className="text-right"
                          />
                        </td>
                        <td className="px-2 py-1.5 w-28">
                          <Input
                            placeholder="0"
                            value={r.excessKg}
                            onChange={(e) => updateRow(idx, { excessKg: e.target.value, ...(e.target.value ? { requiredKg: '' } : {}) })}
                            className="text-right"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          {(!isExisting || isAdmin) && (
                            <IconBtn title="Remove row" danger onClick={() => removeGridRow(idx)}>
                              <Trash2 size={13} />
                            </IconBtn>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 border-t border-stone-200">
              <button onClick={addGridRow} className="text-xs font-medium text-[#0D9488] hover:underline">
                + Add row
              </button>
            </div>
            {error && <div className="px-4 pb-2 text-xs text-[#0D9488]">{error}</div>}
            <div className="px-4 py-3 border-t border-stone-200">
              <Btn onClick={submit} disabled={saving}>
                <Save size={15} /> {saving ? 'Saving…' : 'Save'}
              </Btn>
            </div>
          </>
        )}
      </Card>

      {addModal?.kind === 'yarn' && <QuickAddYarnTypeModal onClose={() => setAddModal(null)} onCreate={createYarnType} />}
      {addModal?.kind === 'colour' && (
        <QuickAddColourModal yarnLabel={yarnTypesById[addModal.yarnTypeId]?.name || ''} onClose={() => setAddModal(null)} onCreate={createColour} />
      )}

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
              <button
                onClick={() => selectWeaver(g.weaver.id)}
                title="Edit this weaver's opening balance above"
                className="w-full text-left px-4 py-2.5 border-b border-stone-200 hover:bg-stone-50"
              >
                <span className="text-sm font-semibold text-stone-800">{g.weaver.name}</span>
              </button>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-stone-400 text-xs">
                      <th className="text-left font-semibold px-4 py-1.5">Yarn Type</th>
                      <th className="text-left font-semibold px-2 py-1.5">Colour Name</th>
                      <th className="text-right font-semibold px-2 py-1.5">Yarn Required</th>
                      <th className="text-right font-semibold px-2 py-1.5">Excess Yarn</th>
                      <th className="w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.items.map((it) => (
                      <tr key={it.id} className="border-t border-stone-100">
                        <td className="px-4 py-1.5 text-stone-800">{it.yarnTypeName}</td>
                        <td className="px-2 py-1.5 text-stone-800">{it.colourName}</td>
                        <td className="px-2 py-1.5 text-right font-mono font-medium" style={{ color: '#DC2626' }}>
                          {it.required_kg > 0 ? fmt(it.required_kg) : ''}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono font-medium" style={{ color: '#16A34A' }}>
                          {it.excess_kg > 0 ? fmt(it.excess_kg) : ''}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center justify-end gap-0.5">
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
                  <tfoot>
                    <tr className="border-t border-stone-200" style={{ backgroundColor: '#FAFAF9' }}>
                      <td colSpan={2} className="px-4 py-1.5 text-right font-semibold text-stone-500 text-xs uppercase tracking-wide">
                        Grand Total
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold" style={{ color: '#DC2626' }}>
                        {fmt(g.subtotalRequired)}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono font-semibold" style={{ color: '#16A34A' }}>
                        {fmt(g.subtotalExcess)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
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
          <div className="flex justify-end px-2">
            <span className="text-sm font-semibold text-stone-700 flex items-center gap-4">
              <span className="text-stone-500 text-xs uppercase tracking-wide">Overall Total</span>
              <span className="font-mono" style={{ color: '#DC2626' }}>
                {fmt(grandTotalRequired)} kg
              </span>
              <span className="font-mono" style={{ color: '#16A34A' }}>
                {fmt(grandTotalExcess)} kg
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
