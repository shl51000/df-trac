import { useEffect, useState } from 'react'
import { ArrowLeft, Check } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { findFabricType } from '../../lib/fabricType'
import { stripReedSuffix, withReedSuffix, stripPickSuffix, withPickSuffix } from '../../lib/suffix'
import { FEEDER_COUNT } from '../../lib/design'
import { Card, Label, Input, SuffixedInput, Btn } from '../../components/ui'
import FeedersTable from './FeedersTable'

// A stable key for the feeders' picks map, independent of whatever the
// Pick field's live text is — see FeedersTable's note on why.
const PICK_KEY = '_pick'

export default function EditDesignForm({ design, existingDesigns, onCancel, onSaved }) {
  const [fabricTypes, setFabricTypes] = useState([])
  useEffect(() => {
    supabase
      .from('fabric_types')
      .select('*')
      .then(({ data }) => setFabricTypes(data ?? []))
  }, [])

  const [designNo, setDesignNo] = useState(design.design_no)
  const [hooks, setHooks] = useState(design.hooks || '')
  const [reed, setReed] = useState(stripReedSuffix(design.reed))
  const [panno, setPanno] = useState(design.panno || '')
  const [salvage, setSalvage] = useState(design.salvage || '')
  const [pick, setPick] = useState(stripPickSuffix(design.pick))
  const [materialType, setMaterialType] = useState(design.material_type || '')
  const [cutSize, setCutSize] = useState(String(design.cut_size ?? '1'))
  const matchedFabricType = findFabricType(designNo, fabricTypes)
  useEffect(() => {
    if (matchedFabricType) setMaterialType(matchedFabricType.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designNo, matchedFabricType?.name])

  const [feeders, setFeeders] = useState(() => {
    const base = Array.from({ length: FEEDER_COUNT }, () => ({ card: '', picks: {} }))
    design.feeders.forEach((f) => {
      if (f.feeder_no >= 1 && f.feeder_no <= FEEDER_COUNT)
        base[f.feeder_no - 1] = { card: f.card || '', picks: { [PICK_KEY]: f.pick != null ? String(f.pick) : '' } }
    })
    return base
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const updateFeederCard = (idx, card) => setFeeders((rows) => rows.map((r, i) => (i === idx ? { ...r, card } : r)))
  const updateFeederPick = (idx, _key, val) =>
    setFeeders((rows) => rows.map((r, i) => (i === idx ? { ...r, picks: { ...r.picks, [PICK_KEY]: val } } : r)))

  const averagePick = feeders.reduce((sum, f) => sum + (Number(f.picks[PICK_KEY]) || 0), 0)

  const submit = async () => {
    const n = designNo.trim()
    const reedRaw = reed.trim()
    const pickRaw = pick.trim()
    if (!n) return setError('Design No is required.')
    if (!hooks.trim()) return setError('Hooks is required.')
    if (!reedRaw) return setError('Reed is required.')
    if (!panno.trim()) return setError('Panno / width is required.')
    if (!pickRaw) return setError('Pick is required.')
    if (!feeders.some((f) => String(f.card || '').trim() !== '' && f.card.trim() !== '-' && f.card.trim() !== '0'))
      return setError('Add at least one feeder card number.')

    const hasSibling = existingDesigns.some((d) => d.id !== design.id && d.design_no.trim().toLowerCase() === n.toLowerCase())
    const pickLabel = withPickSuffix(pickRaw)
    const label = hasSibling ? `${n} (${pickLabel})` : n
    if (existingDesigns.some((d) => d.id !== design.id && d.label === label)) {
      setError(`"${label}" already exists in the Design Library.`)
      return
    }

    setSaving(true)
    const { error: updErr } = await supabase
      .from('designs')
      .update({
        design_no: n,
        label,
        hooks: hooks.trim(),
        reed: withReedSuffix(reedRaw),
        panno: panno.trim(),
        salvage: salvage.trim() || null,
        pick: pickLabel,
        material_type: materialType.trim(),
        cut_size: cutSize.trim() || '1',
        average_pick: averagePick,
      })
      .eq('id', design.id)
    if (updErr) {
      setError(updErr.message)
      setSaving(false)
      return
    }

    const feederRows = feeders.map((f, i) => ({
      design_id: design.id,
      feeder_no: i + 1,
      card: f.card.trim(),
      pick: f.picks[PICK_KEY] || null,
    }))
    await supabase.from('design_feeders').upsert(feederRows, { onConflict: 'design_id,feeder_no' })

    setSaving(false)
    onSaved()
  }

  return (
    <div>
      <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4">
        <ArrowLeft size={15} /> Back
      </button>
      <h1 className="text-2xl font-semibold text-stone-900 mb-6">Edit Design — {design.label}</h1>

      <Card className="p-5 max-w-2xl mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Design No</Label>
            <Input
              value={designNo}
              onChange={(e) => {
                setDesignNo(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Hooks</Label>
            <Input
              value={hooks}
              onChange={(e) => {
                setHooks(e.target.value)
                setError('')
              }}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <div>
            <Label>Width</Label>
            <Input
              value={panno}
              onChange={(e) => {
                setPanno(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Reed</Label>
            <SuffixedInput
              suffix="r"
              value={reed}
              onChange={(e) => {
                setReed(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Salvage (if any)</Label>
            <Input value={salvage} onChange={(e) => setSalvage(e.target.value)} placeholder="—" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <div className="max-w-[160px]">
            <Label>Pick</Label>
            <SuffixedInput
              suffix="p"
              value={pick}
              onChange={(e) => {
                setPick(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Material Type</Label>
            <Input
              value={materialType}
              onChange={(e) => setMaterialType(e.target.value)}
              disabled={!!matchedFabricType}
              placeholder={matchedFabricType ? '' : 'Not set up in Fabric Types'}
            />
          </div>
          <div>
            <Label>Cut Size</Label>
            <Input value={cutSize} onChange={(e) => setCutSize(e.target.value)} placeholder="1" />
          </div>
        </div>
      </Card>

      <FeedersTable
        feeders={feeders}
        pickValues={[PICK_KEY]}
        labels={{ [PICK_KEY]: withPickSuffix(pick) }}
        onUpdateCard={updateFeederCard}
        onUpdatePick={updateFeederPick}
      />

      {error && <div className="text-sm mb-3 text-[#0D9488]">{error}</div>}
      <div className="flex gap-2">
        <Btn onClick={submit} disabled={saving}>
          <Check size={15} /> {saving ? 'Saving…' : 'Save changes'}
        </Btn>
        <Btn variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Btn>
      </div>
    </div>
  )
}
