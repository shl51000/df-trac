import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { loadDesignSheetUrl } from '../lib/designSheets'

// Shared by Design Library and Production Orders — both store their
// uploaded sheet photo in the same generic `design_sheets` table/bucket.
export default function SheetViewerModal({ sheetId, onClose }) {
  const [imgUrl, setImgUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const [fileName, setFileName] = useState('')

  useEffect(() => {
    let cancelled = false
    setImgUrl(null)
    setFailed(false)
    supabase
      .from('design_sheets')
      .select('storage_path, file_name')
      .eq('id', sheetId)
      .single()
      .then(async ({ data, error }) => {
        if (cancelled || error || !data) {
          if (!cancelled) setFailed(true)
          return
        }
        setFileName(data.file_name || '')
        const url = await loadDesignSheetUrl(data.storage_path)
        if (cancelled) return
        if (url) setImgUrl(url)
        else setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [sheetId])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 shrink-0">
          <span className="text-sm font-semibold text-stone-800">{fileName || 'Uploaded sheet'}</span>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-auto flex items-center justify-center min-h-[160px]">
          {imgUrl ? (
            <img src={imgUrl} alt="Uploaded sheet" className="w-full h-auto block" />
          ) : failed ? (
            <p className="text-sm text-stone-500 py-10">Couldn't load this sheet.</p>
          ) : (
            <Loader2 className="animate-spin text-stone-400 my-10" size={22} />
          )}
        </div>
      </div>
    </div>
  )
}
