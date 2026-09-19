// html2canvas is loaded on demand from cdnjs (never bundled) so a Download
// or Share click is the only thing that pays for it.
const HTML2CANVAS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'

function loadScriptOnce(src, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve()
      return
    }
    const s = document.createElement('script')
    s.src = src
    const timer = setTimeout(() => {
      reject(new Error('Timed out loading a required script — this environment may be blocking external scripts, or the network is slow.'))
    }, timeoutMs)
    s.onload = () => {
      clearTimeout(timer)
      resolve()
    }
    s.onerror = () => {
      clearTimeout(timer)
      reject(new Error('Could not load a required script — this environment may be blocking external scripts.'))
    }
    document.body.appendChild(s)
  })
}

async function ensureCanvasLib() {
  if (typeof window.html2canvas !== 'function') await loadScriptOnce(HTML2CANVAS_SRC)
  if (typeof window.html2canvas !== 'function') throw new Error("The image-generation library didn't load correctly.")
}

async function captureCanvas(el) {
  await ensureCanvasLib()
  try {
    return await window.html2canvas(el, { backgroundColor: '#ffffff', scale: 2 })
  } catch (e) {
    throw new Error(`Couldn't render this to an image (${e?.message || 'unknown error'}).`, { cause: e })
  }
}

export async function captureElementAsJPG(el) {
  return (await captureCanvas(el)).toDataURL('image/jpeg', 0.92)
}

// Renders the element to an A4 portrait PDF. Content that overflows one
// page by a little is shrunk to fit; anything longer flows onto extra pages.
// jsPDF is bundled but only fetched on the first PDF click.
export async function downloadElementAsPDF(el, fileName) {
  const canvas = await captureCanvas(el)
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const margin = 10
  const boxW = pdf.internal.pageSize.getWidth() - margin * 2
  const boxH = pdf.internal.pageSize.getHeight() - margin * 2

  let mmPerPx = boxW / canvas.width
  if (canvas.height * mmPerPx <= boxH * 1.15) mmPerPx = Math.min(mmPerPx, boxH / canvas.height)
  const drawW = canvas.width * mmPerPx
  const x = margin + (boxW - drawW) / 2
  const slicePx = Math.floor(boxH / mmPerPx)

  for (let y = 0, page = 0; y < canvas.height; y += slicePx, page++) {
    const h = Math.min(slicePx, canvas.height - y)
    const slice = document.createElement('canvas')
    slice.width = canvas.width
    slice.height = h
    const ctx = slice.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, slice.width, slice.height)
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
    if (page > 0) pdf.addPage()
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', x, margin, drawW, h * mmPerPx)
  }
  pdf.save(fileName.replace(/[\\/:*?"<>|]/g, '-'))
}

export function downloadDataUrl(dataUrl, fileName) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// A tab opened synchronously inside the click handler (before any await)
// still carries the click's "user activation", so navigating it later
// isn't treated as a popup — opening a *fresh* tab after an await almost
// always is, which is why the WhatsApp/email fallback used to silently
// get blocked. Callers open this with window.open('', '_blank') at the
// very top of their click handler and pass it in here.
function navigatePreOpened(preOpenedWindow, url) {
  if (preOpenedWindow && !preOpenedWindow.closed) preOpenedWindow.location = url
  else window.open(url, '_blank')
}

// Tries the native share sheet (WhatsApp shows up as a target on phones)
// with the actual image file attached. Falls back to opening WhatsApp with
// the order details as text — a browser can't attach a file to that link
// on its own, so the JPG still needs to be downloaded and attached by hand.
export async function shareJPGOnWhatsApp(dataUrl, fileName, captionText, preOpenedWindow) {
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], fileName, { type: 'image/jpeg' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      preOpenedWindow?.close()
      await navigator.share({ files: [file], title: fileName, text: captionText })
      return 'shared'
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      preOpenedWindow?.close()
      return 'cancelled'
    }
  }
  downloadDataUrl(dataUrl, fileName)
  navigatePreOpened(preOpenedWindow, `https://wa.me/?text=${encodeURIComponent(captionText)}`)
  return 'fallback'
}

export async function shareFileByEmail(dataUrl, fileName, mimeType, subject, bodyText, preOpenedWindow) {
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], fileName, { type: mimeType })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      preOpenedWindow?.close()
      await navigator.share({ files: [file], title: fileName, text: bodyText })
      return 'shared'
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      preOpenedWindow?.close()
      return 'cancelled'
    }
  }
  downloadDataUrl(dataUrl, fileName)
  navigatePreOpened(preOpenedWindow, `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`)
  return 'fallback'
}

export function downloadCSV(fileName, headers, rows) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadJSON(fileName, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
