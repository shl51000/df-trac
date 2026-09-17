import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Upload, FileEdit, Loader2, Plus, X, Check } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { uploadDesignSheet } from '../../lib/designSheets'
import { compressImageDataUrl, readFileAsDataUrl } from '../../lib/image'
import { findFabricType } from '../../lib/fabricType'
import { stripReedSuffix, withReedSuffix, stripPickSuffix, withPickSuffix } from '../../lib/suffix'
import { emptyFeeders, isActiveCard, computeAveragePick, FEEDER_COUNT } from '../../lib/design'
import { Card, Label, Input, SuffixedInput, Btn } from '../../components/ui'
import FeedersTable from './FeedersTable'

// Best-effort read of a spec-sheet photo via the extract-spec-sheet Edge
// Function. Until that function is deployed (it needs an ANTHROPIC_API_KEY
// secret set first) this simply fails and the caller falls back to a blank
// manual-entry form — same graceful-degradation behaviour either way.
async function extractSpecSheet(imageBase64, mediaType) {
  const { data, error } = await supabase.functions.invoke('extract-spec-sheet', { body: { imageBase64, mediaType } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

export default function NewDesignFlow({ existingDesigns, onCancel, onSaved }) {
  const [step, setStep] = useState('choose') // "choose" | "manual"
  const [prefill, setPrefill] = useState(null)
  const [sheetDraft, setSheetDraft] = useState(null) // { dataUrl, fileName }
  const [uploadNotice, setUploadNotice] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  const handleFile = async (file) => {
    setUploadError('')
    setUploadNotice('')
    setUploading(true)
    let dataUrl
    try {
      dataUrl = await readFileAsDataUrl(file)
      dataUrl = await compressImageDataUrl(dataUrl)
    } catch {
      setUploadError("Couldn't read that file — please try another photo.")
      setUploading(false)
      return
    }
    setSheetDraft({ dataUrl, fileName: file.name })
    try {
      const extracted = await extractSpecSheet(dataUrl.split(',')[1], file.type || 'image/jpeg')
      setPrefill(extracted)
    } catch {
      setPrefill(null)
      setUploadNotice("Couldn't read the fields automatically — the photo is attached below; please fill them in.")
    } finally {
      setUploading(false)
      setStep('manual')
    }
  }

  if (step === 'choose') {
    return (
      <div>
        <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4">
          <ArrowLeft size={15} /> Back to Design Library
        </button>
        <h1 className="text-2xl font-semibold text-stone-900 mb-1">New Design</h1>
        <p className="text-sm text-stone-500 mb-6 max-w-2xl">Upload a spec sheet photo and let it read the fields, or enter everything by hand.</p>
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-left">
            <Card className="p-5 h-full hover:border-[#0D9488] transition-colors">
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mb-3">
                {uploading ? <Loader2 size={18} className="text-[#0D9488] animate-spin" /> : <Upload size={18} className="text-[#0D9488]" />}
              </div>
              <div className="text-sm font-semibold text-stone-800">Upload Spec Sheet</div>
              <div className="text-xs text-stone-500 mt-1">
                {uploading ? 'Reading the sheet…' : 'Photo or scan of the design sheet — fields are read automatically for you to review, and the photo is saved for later.'}
              </div>
            </Card>
          </button>
          <button
            onClick={() => {
              setPrefill(null)
              setSheetDraft(null)
              setStep('manual')
            }}
            className="text-left"
          >
            <Card className="p-5 h-full hover:border-[#0D9488] transition-colors">
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mb-3">
                <FileEdit size={18} className="text-[#0D9488]" />
              </div>
              <div className="text-sm font-semibold text-stone-800">Manual Entry</div>
              <div className="text-xs text-stone-500 mt-1">Type in Design No, Hooks, Reed, Panno and the feeder table yourself.</div>
            </Card>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ''
          }}
        />
        {uploadError && <div className="text-xs mt-3 text-[#0D9488] max-w-2xl">{uploadError}</div>}
      </div>
    )
  }

  return (
    <ManualDesignForm
      prefill={prefill}
      uploadNotice={uploadNotice}
      sheetDraft={sheetDraft}
      existingDesigns={existingDesigns}
      onBack={() => setStep('choose')}
      onCancel={onCancel}
      onSaved={onSaved}
    />
  )
}

function ManualDesignForm({ prefill, uploadNotice, sheetDraft, existingDesigns, onBack, onCancel, onSaved }) {
  const [fabricTypes, setFabricTypes] = useState([])
  useEffect(() => {
    supabase
      .from('fabric_types')
      .select('*')
      .then(({ data }) => setFabricTypes(data ?? []))
  }, [])

  const [designNo, setDesignNo] = useState(prefill?.designNo || '')
  const [hooks, setHooks] = useState(prefill?.hooks || '')
  const [reed, setReed] = useState(stripReedSuffix(prefill?.reed || ''))
  const [panno, setPanno] = useState(prefill?.panno || '')
  const [salvage, setSalvage] = useState(prefill?.salvage || '')
  const [materialType, setMaterialType] = useState(prefill?.materialType || '')
  const [cutSize, setCutSize] = useState(prefill?.cutSize || '1')
  const matchedFabricType = findFabricType(designNo, fabricTypes)

  // Material Type is captured automatically from the Fabric Type whose Code
  // matches the Design No's prefix — it isn't typed in by hand once that match exists.
  useEffect(() => {
    if (matchedFabricType) setMaterialType(matchedFabricType.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designNo, matchedFabricType?.name])

  const [pickValues, setPickValues] = useState(prefill?.pickValues?.length ? prefill.pickValues.map(stripPickSuffix) : [''])
  const [pickDraft, setPickDraft] = useState('')
  const [feeders, setFeeders] = useState(() => {
    const base = emptyFeeders()
    if (prefill?.feeders) {
      prefill.feeders.forEach((f, i) => {
        if (i < FEEDER_COUNT) base[i] = { card: f.card || '', picks: { ...(f.picks || {}) } }
      })
    }
    return base
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const addPickValue = () => {
    const v = stripPickSuffix(pickDraft)
    if (!v) return
    if (pickValues.includes(v)) {
      setPickDraft('')
      return
    }
    setPickValues([...pickValues.filter(Boolean), v])
    setPickDraft('')
  }
  const removePickValue = (v) => {
    if (pickValues.length <= 1) return
    setPickValues(pickValues.filter((p) => p !== v))
  }

  const updateFeederCard = (idx, card) => setFeeders((rows) => rows.map((r, i) => (i === idx ? { ...r, card } : r)))
  const updateFeederPick = (idx, pickValue, val) =>
    setFeeders((rows) => rows.map((r, i) => (i === idx ? { ...r, picks: { ...r.picks, [pickValue]: val } } : r)))

  const activePickValues = pickValues.filter(Boolean)

  const submit = async () => {
    const n = designNo.trim()
    const reedRaw = reed.trim()
    if (!n) return setError('Design No is required.')
    if (!hooks.trim()) return setError('Hooks is required.')
    if (!reedRaw) return setError('Reed is required.')
    if (!panno.trim()) return setError('Panno / width is required.')
    if (activePickValues.length === 0) return setError('Add at least one base pick value.')
    if (!feeders.some((f) => isActiveCard(f.card))) return setError('Add at least one feeder card number.')

    const multi = activePickValues.length > 1
    const records = []
    for (const pv of activePickValues) {
      const pickLabel = withPickSuffix(pv)
      const label = multi ? `${n} (${pickLabel})` : n
      if (existingDesigns.some((d) => d.label === label)) {
        setError(`"${label}" already exists in the Design Library.`)
        return
      }
      records.push({ label, pick: pickLabel, averagePick: computeAveragePick(feeders, pv), pv })
    }

    setSaving(true)
    let sheetId = null
    if (sheetDraft) {
      const sheet = await uploadDesignSheet(sheetDraft.dataUrl, sheetDraft.fileName)
      sheetId = sheet?.id ?? null
    }

    for (const rec of records) {
      const { data: design, error: insErr } = await supabase
        .from('designs')
        .insert({
          design_no: n,
          label: rec.label,
          hooks: hooks.trim(),
          reed: withReedSuffix(reedRaw),
          panno: panno.trim(),
          salvage: salvage.trim() || null,
          pick: rec.pick,
          material_type: materialType.trim(),
          cut_size: cutSize.trim() || '1',
          average_pick: rec.averagePick,
          sheet_id: sheetId,
        })
        .select()
        .single()
      if (insErr) {
        setError(insErr.message)
        setSaving(false)
        return
      }
      const feederRows = feeders.map((f, i) => ({
        design_id: design.id,
        feeder_no: i + 1,
        card: f.card.trim(),
        pick: f.picks[rec.pv] || null,
      }))
      await supabase.from('design_feeders').insert(feederRows)
    }
    setSaving(false)
    onSaved()
  }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4">
        <ArrowLeft size={15} /> Back
      </button>
      <h1 className="text-2xl font-semibold text-stone-900 mb-6">New Design — Manual Entry</h1>

      {prefill && (
        <div style={{ backgroundColor: '#F0FDFA' }} className="rounded px-3 py-2 text-xs text-[#0F766E] mb-5 max-w-2xl">
          Read from the uploaded sheet — check every field below before saving.
        </div>
      )}
      {uploadNotice && <div className="rounded px-3 py-2 text-xs bg-amber-50 text-amber-700 mb-5 max-w-2xl">{uploadNotice}</div>}
      {sheetDraft && (
        <div className="mb-5 max-w-2xl">
          <Label>Uploaded sheet</Label>
          <img src={sheetDraft.dataUrl} alt="Uploaded spec sheet" className="rounded border border-stone-200 max-h-64 w-auto" />
        </div>
      )}

      <Card className="p-5 max-w-2xl mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Design No</Label>
            <Input
              placeholder="e.g. MS-147"
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
              placeholder="e.g. 2640"
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
              placeholder='e.g. 48"'
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
              placeholder="e.g. 96"
              value={reed}
              onChange={(e) => {
                setReed(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Salvage (if any)</Label>
            <Input placeholder="—" value={salvage} onChange={(e) => setSalvage(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 items-start">
          <div>
            <Label>Base pick values</Label>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {activePickValues.map((v) => (
                <span key={v} className="inline-flex items-center gap-1.5 bg-stone-100 text-stone-700 text-sm font-medium px-2.5 py-1 rounded-full">
                  {withPickSuffix(v)}
                  {pickValues.length > 1 && (
                    <button onClick={() => removePickValue(v)} className="text-stone-400 hover:text-[#0D9488]">
                      <X size={12} />
                    </button>
                  )}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. 60"
                value={pickDraft}
                onChange={(e) => setPickDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addPickValue()
                  }
                }}
              />
              <Btn variant="ghost" onClick={addPickValue}>
                <Plus size={14} /> Add
              </Btn>
            </div>
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
        {activePickValues.length > 1 && (
          <p className="text-xs text-stone-500 mt-2">
            This will create {activePickValues.length} separate designs —{' '}
            {activePickValues.map((v) => `"${designNo || '…'} (${withPickSuffix(v)})"`).join(', ')}.
          </p>
        )}
      </Card>

      <FeedersTable feeders={feeders} pickValues={activePickValues} onUpdateCard={updateFeederCard} onUpdatePick={updateFeederPick} />

      {error && <div className="text-sm mb-3 text-[#0D9488]">{error}</div>}
      <div className="flex gap-2">
        <Btn onClick={submit} disabled={saving}>
          <Check size={15} /> {saving ? 'Saving…' : `Save design${activePickValues.length > 1 ? 's' : ''}`}
        </Btn>
        <Btn variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Btn>
      </div>
    </div>
  )
}
