import { useRef, useState } from 'react'
import { ArrowLeft, Upload, FileEdit, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { compressImageDataUrl, readFileAsDataUrl } from '../../lib/image'
import { Card, Header } from '../../components/ui'
import ManualProductionOrderForm from './ManualProductionOrderForm'

// Best-effort read of a PO screenshot via the extract-production-order Edge
// Function. Until that function is deployed (it needs an ANTHROPIC_API_KEY
// secret set first, shared with extract-spec-sheet) this simply fails and
// the caller falls back to a blank manual-entry form — same
// graceful-degradation behaviour either way.
async function extractProductionOrder(imageBase64, mediaType) {
  const { data, error } = await supabase.functions.invoke('extract-production-order', { body: { imageBase64, mediaType } })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

export default function NewProductionOrderFlow({ onCancel, onSaved }) {
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
      const extracted = await extractProductionOrder(dataUrl.split(',')[1], file.type || 'image/jpeg')
      setPrefill(extracted)
    } catch {
      setPrefill(null)
      setUploadNotice("Couldn't read this automatically — please fill in the fields below.")
    } finally {
      setUploading(false)
      setStep('manual')
    }
  }

  if (step === 'choose') {
    return (
      <div>
        <button onClick={onCancel} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium mb-4">
          <ArrowLeft size={15} /> Back to Production Orders
        </button>
        <Header title="New Production Order" subtitle="Upload a PO screenshot and let it read the fields, or enter everything by hand." />
        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-left">
            <Card className="p-5 h-full hover:border-[#0D9488] transition-colors">
              <div className="w-10 h-10 rounded-full bg-stone-100 flex items-center justify-center mb-3">
                {uploading ? <Loader2 size={18} className="text-[#0D9488] animate-spin" /> : <Upload size={18} className="text-[#0D9488]" />}
              </div>
              <div className="text-sm font-semibold text-stone-800">Upload Screenshot</div>
              <div className="text-xs text-stone-500 mt-1">{uploading ? 'Reading…' : 'A photo or screenshot of the order — fields are read automatically for you to review.'}</div>
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
              <div className="text-xs text-stone-500 mt-1">Type in the PO details and feeder quantities yourself.</div>
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
    <ManualProductionOrderForm
      prefill={prefill}
      uploadNotice={uploadNotice}
      sheetDraft={sheetDraft}
      onBack={() => setStep('choose')}
      onCancel={onCancel}
      onSaved={onSaved}
    />
  )
}
