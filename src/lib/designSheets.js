import { supabase } from './supabaseClient'
import { dataUrlToBlob } from './image'

const BUCKET = 'design-sheets'

// Uploads a compressed spec-sheet photo to Storage and records its
// metadata row. Only links a sheet the upload actually confirmed —
// otherwise "View Sheet" would show up and just fail every time it's
// clicked.
export async function uploadDesignSheet(dataUrl, fileName) {
  const blob = dataUrlToBlob(dataUrl)
  const path = `${crypto.randomUUID()}.jpg`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
  if (uploadError) return null

  const { data, error } = await supabase.from('design_sheets').insert({ storage_path: path, file_name: fileName }).select().single()
  if (error) return null
  return data
}

export async function loadDesignSheetUrl(storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error || !data) return null
  return URL.createObjectURL(data)
}
