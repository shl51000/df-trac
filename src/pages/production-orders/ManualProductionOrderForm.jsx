import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Plus, X, Image as ImageIcon } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { withDenierSuffix, stripDenierSuffix, stripPickSuffix } from '../../lib/suffix'
import { findFabricType, getDesignPrefix } from '../../lib/fabricType'
import { isActiveCard, designCutSize, lineMtsEquivalent } from '../../lib/design'
import { fmt } from '../../lib/format'
import { todayISO } from '../../lib/fy'
import { uploadDesignSheet } from '../../lib/designSheets'
import { Card, Label, Input, Select, Btn, AddBtn } from '../../components/ui'
import SheetViewerModal from '../../components/SheetViewerModal'
import { QuickAddWeaverModal, QuickAddYarnTypeModal, QuickAddColourModal } from './QuickAddModals'

export default function ManualProductionOrderForm({ editingOrder, prefill, uploadNotice, sheetDraft, onBack, onCancel, onSaved }) {
  const [weavers, setWeavers] = useState([])
  const [designs, setDesigns] = useState([]) // each with .feeders
  const [yarnTypes, setYarnTypes] = useState([]) // each with .colours
  const [fabricTypes, setFabricTypes] = useState([])
  const [loaded, setLoaded] = useState(false)

  const loadMasters = async () => {
    const [{ data: w }, { data: d }, { data: df }, { data: yt }, { data: yc }, { data: ft }] = await Promise.all([
      supabase.from('weavers').select('*').eq('is_active', true).order('name'),
      supabase.from('designs').select('*').eq('is_active', true),
      supabase.from('design_feeders').select('*'),
      supabase.from('yarn_types').select('*').eq('is_active', true).order('name'),
      supabase.from('yarn_colours').select('*'),
      supabase.from('fabric_types').select('*'),
    ])
    setWeavers(w ?? [])
    setDesigns((d ?? []).map((design) => ({ ...design, feeders: (df ?? []).filter((f) => f.design_id === design.id).sort((a, b) => a.feeder_no - b.feeder_no) })))
    setYarnTypes((yt ?? []).map((y) => ({ ...y, colours: (yc ?? []).filter((c) => c.yarn_type_id === y.id) })))
    setFabricTypes(ft ?? [])
    setLoaded(true)
  }
  useEffect(() => {
    loadMasters()
  }, [])

  const [poNo, setPoNo] = useState(editingOrder?.po_no || prefill?.poNo || '')
  const [poDate, setPoDate] = useState(editingOrder?.po_date || prefill?.poDate || todayISO())
  const [weaverId, setWeaverId] = useState(editingOrder?.weaver_id || '')
  const [width, setWidth] = useState(editingOrder?.width != null ? String(editingOrder.width) : prefill?.width || '')
  const [remarks, setRemarks] = useState(editingOrder?.remarks || '')
  const [designId, setDesignId] = useState(editingOrder?.design_id || '')
  const [feederQuality, setFeederQuality] = useState(editingOrder ? editingOrder.feederQuality.map((f) => ({ yarnTypeId: f.yarn_type_id })) : [])
  const [lines, setLines] = useState(editingOrder ? editingOrder.lines.map((l) => ({ id: crypto.randomUUID(), qty: String(l.qty), colours: l.colours })) : [])
  const [warpYarnTypeId, setWarpYarnTypeId] = useState(editingOrder?.warp_yarn_type_id || '')
  const [warpColourId, setWarpColourId] = useState(editingOrder?.warp_colour_id || '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [addModal, setAddModal] = useState(null)
  const [viewingUploadedSheet, setViewingUploadedSheet] = useState(false)

  const warpYarnType = warpYarnTypeId ? yarnTypes.find((y) => y.id === warpYarnTypeId) : null
  const selectedDesign = designId ? designs.find((d) => d.id === designId) : null
  const fabricType = selectedDesign ? findFabricType(selectedDesign.design_no, fabricTypes) : null
  const unit = fabricType?.measuring_term || 'Mts'
  const activeFeeders = selectedDesign ? selectedDesign.feeders.filter((f) => isActiveCard(f.card)) : []
  const cutSizeForTotals = designCutSize(selectedDesign)

  const emptyLine = () => ({ id: crypto.randomUUID(), colours: activeFeeders.map(() => ''), qty: '' })

  // Resets the two grids to blank whenever the selected design actually
  // changes, then (if there's an uploaded sheet to read from) immediately
  // seeds them from its best-effort text matches — but not on mount for an
  // edit, whose grids are already seeded from the saved order.
  //
  // Both steps are folded into this one effect, keyed only on the
  // primitive `designId` rather than the `selectedDesign` object: keying
  // on the object was tried first and turned out unsafe, because
  // `designs`/`selectedDesign` get brand-new references on every
  // loadMasters() reload (e.g. after a quick-add elsewhere on this same
  // form) even when `designId` itself hasn't changed — that would
  // re-fire this effect and silently discard whatever the user had
  // already typed into the grids since the initial seed.
  //
  // A one-shot "skip the first run" ref is *also* not safe here for a
  // different reason: React 18 StrictMode (dev only) double-invokes a
  // mount effect, and a ref that flips true->false on the first call lets
  // the second call fall through and wipe the just-restored rows (this
  // was a real bug — edit would silently lose its feeder quality/
  // colourways on open). Comparing against the last design id this effect
  // actually handled is idempotent under that double-invoke instead.
  const lastHandledDesignId = useRef(editingOrder ? editingOrder.design_id : undefined)
  useEffect(() => {
    if (designId === lastHandledDesignId.current) return
    lastHandledDesignId.current = designId
    if (!selectedDesign) {
      setFeederQuality([])
      setLines([])
      return
    }
    setWidth((selectedDesign.panno || '').replace(/["\s]+$/, ''))
    const feeders = selectedDesign.feeders.filter((f) => isActiveCard(f.card))
    if (!prefill) {
      setFeederQuality(feeders.map(() => ({ yarnTypeId: '' })))
      setLines([{ id: crypto.randomUUID(), colours: feeders.map(() => ''), qty: '' }])
      return
    }
    // Best-effort match of the uploaded sheet's text onto existing Yarn
    // Library names/colours — anything unmatched is just left blank to
    // pick. Colours are filled in by the effect below, once these yarn
    // types resolve.
    setFeederQuality(
      feeders.map((_, i) => {
        const word = (prefill.feederQuality?.[i]?.yarnQuality || '').toLowerCase().trim()
        const yt = word ? yarnTypes.find((y) => word.includes(y.name.toLowerCase()) || `${y.name} ${y.denier}`.toLowerCase().includes(word)) : null
        return { yarnTypeId: yt ? yt.id : '' }
      })
    )
    setLines(
      prefill.lines?.length
        ? prefill.lines.map((srcLine) => ({ id: crypto.randomUUID(), qty: srcLine.qty || '', colours: feeders.map(() => '') }))
        : [{ id: crypto.randomUUID(), colours: feeders.map(() => ''), qty: '' }]
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId])

  // Auto-match the uploaded sheet's read Design No (+ Pick, to disambiguate
  // a design that exists at more than one base Pick) onto a real design —
  // only once there's exactly one confident candidate; guessing wrong
  // between pick variants is worse than leaving it for a manual choice.
  // Can't be a plain useState initializer (like the prototype did) because
  // `designs` here loads asynchronously and is still empty at mount; the
  // `!designId` guard makes this safe to run again if `designs` changes
  // for any reason without ever fighting a design the user picked/cleared
  // themselves.
  useEffect(() => {
    if (editingOrder || designId || !prefill?.designNo || designs.length === 0) return
    const candidates = designs.filter((d) => d.design_no.trim().toLowerCase() === prefill.designNo.trim().toLowerCase())
    if (candidates.length === 0) return
    if (candidates.length === 1) {
      setDesignId(candidates[0].id)
      return
    }
    const wantPick = prefill.pick ? stripPickSuffix(prefill.pick).toLowerCase() : ''
    const exact = wantPick ? candidates.find((d) => stripPickSuffix(d.pick).toLowerCase() === wantPick) : null
    if (exact) setDesignId(exact.id)
  }, [designs, prefill, editingOrder, designId])

  // Warp yarn/colour match doesn't depend on the selected design, so it
  // resolves as soon as prefill text is available — but `yarnTypes` starts
  // empty and only settles after `loadMasters()` resolves, so this has to
  // stay reactive to it (unlike the prototype's synchronous data) without
  // re-firing on every LATER yarnTypes reload too (e.g. from a quick-add):
  // the `!warpYarnTypeId` guard means it only ever applies its match once,
  // never fighting a choice the user or a quick-add already made.
  useEffect(() => {
    const word = (prefill?.warpYarnQuality || '').toLowerCase().trim()
    if (!word || editingOrder || warpYarnTypeId) return
    const yt = yarnTypes.find((y) => word.includes(y.name.toLowerCase()))
    if (!yt) return
    setWarpYarnTypeId(yt.id)
    const col = yt.colours.find((c) => word.includes(c.colour_name.toLowerCase()))
    if (col) setWarpColourId(col.id)
  }, [prefill, yarnTypes, editingOrder, warpYarnTypeId])

  // Second pass: once feederQuality has resolved yarn types, try to match
  // each prefilled line's colour text against that feeder's colour subset.
  useEffect(() => {
    if (!prefill?.lines?.length || feederQuality.every((r) => !r.yarnTypeId)) return
    setLines((prev) =>
      prev.map((line, li) => {
        const src = prefill.lines[li]
        if (!src) return line
        const colours = line.colours.map((existing, fi) => {
          if (existing) return existing
          const yt = yarnTypes.find((y) => y.id === feederQuality[fi]?.yarnTypeId)
          if (!yt) return existing
          const text = (src.colours?.find((c) => c.feeder === fi + 1)?.colourText || '').toLowerCase()
          const col = text ? yt.colours.find((c) => text.includes(c.colour_name.toLowerCase())) : null
          return col ? col.id : existing
        })
        return { ...line, colours }
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feederQuality])

  // Rebuild against activeFeeders.length rather than mapping the existing
  // array in place — an edit whose stored feederQuality/colours came back
  // shorter than the design's current active-feeder count (e.g. leftover
  // data from an earlier failed save) would otherwise silently no-op every
  // update, since .map() over a too-short array can never grow it.
  const setFeederQualityAt = (fi, yarnTypeId) => {
    setFeederQuality((rows) => activeFeeders.map((_, i) => (i === fi ? { yarnTypeId } : rows[i] || { yarnTypeId: '' })))
    setLines((rows) => rows.map((l) => ({ ...l, colours: activeFeeders.map((_, i) => (i === fi ? '' : l.colours[i] || '')) })))
  }
  const updateLine = (lineId, patch) => setLines((rows) => rows.map((l) => (l.id === lineId ? { ...l, ...patch } : l)))
  const updateLineColour = (lineId, fi, colourId) =>
    setLines((rows) =>
      rows.map((l) => (l.id === lineId ? { ...l, colours: activeFeeders.map((_, i) => (i === fi ? colourId : l.colours[i] || '')) } : l))
    )
  const addLine = () => setLines((rows) => [...rows, emptyLine()])
  const removeLine = (lineId) => setLines((rows) => (rows.length > 1 ? rows.filter((l) => l.id !== lineId) : rows))

  const totalMtrs = lines.reduce((sum, l) => sum + lineMtsEquivalent(l.qty, unit, cutSizeForTotals), 0)

  // Quick-add handlers write straight to the real Yarn Library / Weavers
  // master (so the new record survives even if this order is later
  // cancelled), then apply the new id to whichever select opened the modal.
  const createYarnType = async (name, denier) => {
    const dNorm = withDenierSuffix(denier)
    const dup = yarnTypes.some((y) => y.name.trim().toLowerCase() === name.toLowerCase() && stripDenierSuffix(y.denier).toLowerCase() === stripDenierSuffix(dNorm).toLowerCase())
    if (dup) return `${name} — ${dNorm} already exists.`
    const { data, error } = await supabase.from('yarn_types').insert({ name, denier: dNorm }).select().single()
    if (error) return friendlyError(error)
    await loadMasters()
    if (addModal.kind === 'warpYarn') {
      setWarpYarnTypeId(data.id)
      setWarpColourId('')
    }
    if (addModal.kind === 'feederYarn') setFeederQualityAt(addModal.feederIndex, data.id)
    setAddModal(null)
    return null
  }
  const createColour = async (colourName) => {
    const yt = yarnTypes.find((y) => y.id === addModal.yarnTypeId)
    if (!yt) return 'Select a yarn quality first.'
    const dup = yt.colours.some((c) => c.colour_name.trim().toLowerCase() === colourName.toLowerCase())
    if (dup) return `"${colourName}" already exists for this yarn.`
    const { data, error } = await supabase.from('yarn_colours').insert({ yarn_type_id: yt.id, colour_name: colourName }).select().single()
    if (error) return friendlyError(error)
    await loadMasters()
    if (addModal.kind === 'warpColour') setWarpColourId(data.id)
    if (addModal.kind === 'lineColour') updateLineColour(addModal.lineId, addModal.feederIndex, data.id)
    setAddModal(null)
    return null
  }
  const createWeaver = async (name, address, whatsapp, email) => {
    const { data, error } = await supabase.from('weavers').insert({ name, address, whatsapp, email }).select().single()
    if (error) return friendlyError(error)
    await loadMasters()
    setWeaverId(data.id)
    setAddModal(null)
    return null
  }

  const submit = async () => {
    const n = poNo.trim()
    if (!n) return setError('PO No is required.')
    if (!poDate) return setError('PO date is required.')
    if (!weaverId) return setError('Select a weaver.')
    if (!width.trim()) return setError('Width is required.')
    if (!warpYarnTypeId) return setError('Select a warp yarn.')
    if (!warpColourId) return setError('Select a warp colour.')
    if (!selectedDesign) return setError('Select a design.')
    if (activeFeeders.length === 0) return setError('This design has no active feeders.')
    if (activeFeeders.some((_, fi) => !feederQuality[fi]?.yarnTypeId)) return setError('Select a yarn quality for every feeder.')
    if (lines.length === 0) return setError('Add at least one colourway row.')
    if (lines.some((l) => !String(l.qty).trim() || activeFeeders.some((_, fi) => !l.colours[fi])))
      return setError('Every colourway row needs a colour for each feeder and a quantity.')

    setSaving(true)
    const weaver = weavers.find((w) => w.id === weaverId)
    const warpColour = warpYarnType.colours.find((c) => c.id === warpColourId)

    const orderPayload = {
      po_no: n,
      po_date: poDate,
      width: width.trim(),
      remarks: remarks.trim(),
      unit,
      cut_size_used: cutSizeForTotals,
      design_id: selectedDesign.id,
      design_no: selectedDesign.design_no,
      design_label: selectedDesign.label,
      reed: selectedDesign.reed,
      pick: selectedDesign.pick,
      weaver_id: weaver.id,
      weaver_name: weaver.name,
      weaver_address: weaver.address,
      weaver_whatsapp: weaver.whatsapp,
      weaver_email: weaver.email,
      warp_yarn_type_id: warpYarnTypeId,
      warp_yarn_type_name: `${warpYarnType.name} ${warpYarnType.denier}`,
      warp_colour_id: warpColourId,
      warp_colour_name: warpColour ? warpColour.colour_name : '',
      total_mtrs: totalMtrs,
    }
    // sheet_id is only ever set here on a fresh order — an edit's payload
    // must never include the key at all, or an update() with no sheetDraft
    // of its own would null out the sheet it already had.
    if (!editingOrder) {
      const sheet = sheetDraft ? await uploadDesignSheet(sheetDraft.dataUrl, sheetDraft.fileName) : null
      orderPayload.sheet_id = sheet?.id ?? null
    }

    let orderId
    if (editingOrder) {
      const { error: updErr } = await supabase.from('production_orders').update(orderPayload).eq('id', editingOrder.id)
      if (updErr) {
        setError(friendlyError(updErr, { onDuplicate: `PO No "${n}" already exists — enter a different one.` }))
        setSaving(false)
        return
      }
      orderId = editingOrder.id
      const { error: delLinesErr } = await supabase.from('production_order_lines').delete().eq('production_order_id', orderId)
      const { error: delFeedersErr } = await supabase.from('production_order_feeder_quality').delete().eq('production_order_id', orderId)
      if (delLinesErr || delFeedersErr) {
        setError(friendlyError(delLinesErr || delFeedersErr))
        setSaving(false)
        return
      }
    } else {
      const { data: inserted, error: insErr } = await supabase.from('production_orders').insert(orderPayload).select().single()
      if (insErr) {
        setError(friendlyError(insErr, { onDuplicate: `PO No "${n}" already exists — enter a different one.` }))
        setSaving(false)
        return
      }
      orderId = inserted.id
    }

    const feederQualityRows = activeFeeders.map((_, i) => {
      const r = feederQuality[i]
      const yt = yarnTypes.find((y) => y.id === r.yarnTypeId)
      return { production_order_id: orderId, feeder_no: i + 1, yarn_type_id: r.yarnTypeId, yarn_type_name: yt ? `${yt.name} ${yt.denier}` : '' }
    })
    const { error: fqErr } = await supabase.from('production_order_feeder_quality').insert(feederQualityRows)
    if (fqErr) {
      setError(`Order saved, but feeder quality couldn't be saved: ${friendlyError(fqErr)} Please try saving again.`)
      setSaving(false)
      return
    }

    for (let li = 0; li < lines.length; li++) {
      const l = lines[li]
      const mts = lineMtsEquivalent(l.qty, unit, cutSizeForTotals)
      const { data: lineRow, error: lineErr } = await supabase
        .from('production_order_lines')
        .insert({ production_order_id: orderId, sl: li + 1, qty: l.qty, mts })
        .select()
        .single()
      if (lineErr) {
        setError(`Order saved, but colourway line ${li + 1} couldn't be saved: ${friendlyError(lineErr)} Please try saving again.`)
        setSaving(false)
        return
      }
      const colourRows = activeFeeders.map((_, fi) => {
        const colourId = l.colours[fi]
        const yt = yarnTypes.find((y) => y.id === feederQuality[fi]?.yarnTypeId)
        const col = yt?.colours.find((c) => c.id === colourId)
        return { line_id: lineRow.id, feeder_no: fi + 1, colour_id: colourId, colour_name: col ? col.colour_name : '' }
      })
      const { error: colErr } = await supabase.from('production_order_line_colours').insert(colourRows)
      if (colErr) {
        setError(`Order saved, but colourway line ${li + 1}'s colours couldn't be saved: ${friendlyError(colErr)} Please try saving again.`)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    onSaved(orderId)
  }

  if (loaded && designs.length === 0) {
    return (
      <div>
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4">
          <ArrowLeft size={15} /> Back
        </button>
        <Card className="p-6 text-sm text-stone-600">Add a design first — Production Orders pull Reed and Base Pick from a saved design. Add one in the Design Library, then come back here.</Card>
      </div>
    )
  }
  if (!loaded) return null

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4">
        <ArrowLeft size={15} /> Back
      </button>
      <h1 className="text-2xl font-semibold text-stone-900 mb-6">{editingOrder ? `Edit Production Order — PO ${editingOrder.po_no}` : 'New Production Order'}</h1>

      {uploadNotice && <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 max-w-2xl">{uploadNotice}</div>}
      {prefill && !uploadNotice && (
        <div style={{ backgroundColor: '#F0FDFA' }} className="rounded px-3 py-2 text-xs text-[#0F766E] mb-5 max-w-2xl">
          Read from the uploaded screenshot — check every field below, including the feeder and colour matches, before saving.
        </div>
      )}
      {prefill?.designNo && !designId && designs.filter((d) => d.design_no.trim().toLowerCase() === prefill.designNo.trim().toLowerCase()).length > 1 && (
        <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 max-w-2xl">
          "{prefill.designNo}" exists at more than one base Pick in your Design Library — pick the right one below rather than trusting an automatic match.
        </div>
      )}
      {sheetDraft && (
        <div className="mb-5 max-w-2xl">
          <Label>Uploaded screenshot</Label>
          <img src={sheetDraft.dataUrl} alt="Uploaded PO screenshot" className="rounded border border-stone-200 max-h-64 w-auto" />
        </div>
      )}
      {editingOrder?.sheet_id && (
        <button onClick={() => setViewingUploadedSheet(true)} className="flex items-center gap-1 text-xs font-medium text-[#0D9488] hover:underline mb-5">
          <ImageIcon size={13} /> View uploaded sheet
        </button>
      )}

      <Card className="p-5 max-w-2xl mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>PO No</Label>
            <Input
              placeholder="e.g. 2219"
              value={poNo}
              onChange={(e) => {
                setPoNo(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>PO date</Label>
            <Input
              type="date"
              value={poDate}
              onChange={(e) => {
                setPoDate(e.target.value)
                setError('')
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <div>
            <Label>Weaver name</Label>
            <div className="flex gap-1.5">
              <Select
                value={weaverId}
                onChange={(e) => {
                  setWeaverId(e.target.value)
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
              <AddBtn title="Add weaver" onClick={() => setAddModal({ kind: 'weaver' })} />
            </div>
          </div>
          <div>
            <Label>Design No</Label>
            <Select
              value={designId}
              onChange={(e) => {
                setDesignId(e.target.value)
                setError('')
              }}
            >
              <option value="">Select design…</option>
              {designs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <div>
            <Label>Width{selectedDesign ? ' (from design, editable)' : ''}</Label>
            <Input
              placeholder="e.g. 48"
              value={width}
              onChange={(e) => {
                setWidth(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Warp yarn</Label>
            <div className="flex gap-1.5">
              <Select
                value={warpYarnTypeId}
                onChange={(e) => {
                  setWarpYarnTypeId(e.target.value)
                  setWarpColourId('')
                  setError('')
                }}
              >
                <option value="">Select…</option>
                {yarnTypes.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name} {y.denier}
                  </option>
                ))}
              </Select>
              <AddBtn title="Add yarn quality" onClick={() => setAddModal({ kind: 'warpYarn' })} />
            </div>
          </div>
          <div>
            <Label>Warp colour</Label>
            <div className="flex gap-1.5">
              <Select value={warpColourId} onChange={(e) => { setWarpColourId(e.target.value); setError('') }} disabled={!warpYarnType}>
                <option value="">{warpYarnType ? 'Select…' : 'Pick warp yarn first'}</option>
                {(warpYarnType?.colours || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.colour_name}
                  </option>
                ))}
              </Select>
              <AddBtn
                title="Add colour"
                disabled={!warpYarnType}
                onClick={() => setAddModal({ kind: 'warpColour', yarnTypeId: warpYarnTypeId, yarnLabel: `${warpYarnType.name} ${warpYarnType.denier}` })}
              />
            </div>
          </div>
        </div>

        <div className="mt-3">
          <Label>Remarks (optional)</Label>
          <Input placeholder="e.g. Deliver by 20th, urgent" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>

        {selectedDesign && (
          <div className="mt-3 flex gap-4 text-xs text-stone-500 flex-wrap">
            <span>
              Reed <span className="font-semibold text-stone-700 font-mono">{selectedDesign.reed}</span> (auto)
            </span>
            <span>
              Base pick <span className="font-semibold text-stone-700 font-mono">{selectedDesign.pick}</span> (auto)
            </span>
            <span>
              Fabric{' '}
              <span className="font-semibold text-stone-700">
                {fabricType ? `${fabricType.name} (${fabricType.measuring_term})` : `Unregistered prefix "${getDesignPrefix(selectedDesign.design_no)}" — showing as Mts`}
              </span>
            </span>
          </div>
        )}
      </Card>

      {selectedDesign && activeFeeders.length > 0 && (
        <>
          <Card className="mb-5">
            <div className="px-4 py-3 border-b border-stone-200">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700">Yarn quality — one per feeder</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-stone-400 text-xs">
                    {activeFeeders.map((f) => (
                      <th key={f.feeder_no} className="text-left font-semibold px-4 py-2">
                        F{f.feeder_no}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-stone-100">
                    {activeFeeders.map((f, i) => (
                      <td key={f.feeder_no} className="px-4 py-1.5 min-w-[190px]">
                        <div className="flex gap-1.5">
                          <Select value={feederQuality[i]?.yarnTypeId || ''} onChange={(e) => setFeederQualityAt(i, e.target.value)}>
                            <option value="">Select…</option>
                            {yarnTypes.map((y) => (
                              <option key={y.id} value={y.id}>
                                {y.name} {y.denier}
                              </option>
                            ))}
                          </Select>
                          <AddBtn title="Add yarn quality" onClick={() => setAddModal({ kind: 'feederYarn', feederIndex: i })} />
                        </div>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mb-5">
            <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700">Colourways</h2>
              <Btn variant="ghost" onClick={addLine}>
                <Plus size={13} /> Add colourway
              </Btn>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="text-stone-400 text-xs">
                    <th className="text-left font-semibold px-4 py-2">SL</th>
                    {activeFeeders.map((f) => (
                      <th key={f.feeder_no} className="text-left font-semibold px-2 py-2">
                        F{f.feeder_no}
                      </th>
                    ))}
                    <th className="text-right font-semibold px-3 py-2">Qty ({unit})</th>
                    {unit === 'Pcs' && <th className="text-right font-semibold px-3 py-2">Mts (auto)</th>}
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, li) => (
                    <tr key={line.id} className="border-t border-stone-100">
                      <td className="px-4 py-1.5 text-stone-500 font-mono">{li + 1}</td>
                      {activeFeeders.map((f, fi) => {
                        const yt = yarnTypes.find((y) => y.id === feederQuality[fi]?.yarnTypeId)
                        return (
                          <td key={f.feeder_no} className="px-2 py-1.5 min-w-[170px]">
                            <div className="flex gap-1.5">
                              <Select value={line.colours[fi] || ''} onChange={(e) => updateLineColour(line.id, fi, e.target.value)} disabled={!yt}>
                                <option value="">{yt ? 'Select…' : '—'}</option>
                                {(yt?.colours || []).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.colour_name}
                                  </option>
                                ))}
                              </Select>
                              <AddBtn
                                title="Add colour"
                                disabled={!yt}
                                onClick={() => setAddModal({ kind: 'lineColour', lineId: line.id, feederIndex: fi, yarnTypeId: yt?.id, yarnLabel: yt ? `${yt.name} ${yt.denier}` : '' })}
                              />
                            </div>
                          </td>
                        )
                      })}
                      <td className="px-3 py-1.5 w-24">
                        <Input className="text-right" value={line.qty} onChange={(e) => updateLine(line.id, { qty: e.target.value })} placeholder="0" />
                      </td>
                      {unit === 'Pcs' && <td className="px-3 py-1.5 w-24 text-right font-mono text-stone-500">{fmt(lineMtsEquivalent(line.qty, unit, cutSizeForTotals))}</td>}
                      <td className="px-2 py-1.5">
                        {lines.length > 1 && (
                          <button onClick={() => removeLine(line.id)} className="text-stone-400 hover:text-[#0D9488]">
                            <X size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-stone-200">
                    <td className="px-4 py-2 text-xs font-semibold text-stone-500" colSpan={activeFeeders.length + 1}>
                      Total {unit}
                      {unit === 'Pcs' && ' / Mts (auto)'}
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-semibold text-stone-800 font-mono" colSpan={unit === 'Pcs' ? 1 : 2}>
                      {fmt(lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0))}
                    </td>
                    {unit === 'Pcs' && (
                      <td className="px-3 py-2 text-right text-sm font-semibold text-stone-800 font-mono" colSpan={2}>
                        {fmt(totalMtrs)}
                      </td>
                    )}
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}

      {error && <div className="text-sm mb-3 text-[#0D9488]">{error}</div>}
      <div className="flex gap-2">
        <Btn onClick={submit} disabled={saving}>
          <Check size={15} /> {saving ? 'Saving…' : editingOrder ? 'Save changes' : 'Save order'}
        </Btn>
        <Btn variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Btn>
      </div>

      {addModal?.kind === 'weaver' && <QuickAddWeaverModal onClose={() => setAddModal(null)} onCreate={createWeaver} />}
      {(addModal?.kind === 'warpYarn' || addModal?.kind === 'feederYarn') && <QuickAddYarnTypeModal onClose={() => setAddModal(null)} onCreate={createYarnType} />}
      {(addModal?.kind === 'warpColour' || addModal?.kind === 'lineColour') && <QuickAddColourModal yarnLabel={addModal.yarnLabel} onClose={() => setAddModal(null)} onCreate={createColour} />}
      {viewingUploadedSheet && editingOrder?.sheet_id && <SheetViewerModal sheetId={editingOrder.sheet_id} onClose={() => setViewingUploadedSheet(false)} />}
    </div>
  )
}
