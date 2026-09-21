import { useRef, useState } from 'react'
import { ArrowLeft, Printer, Download, FileDown, Mail, Share2, Loader2 } from 'lucide-react'
import { fmt, fmtDateDMY } from '../../lib/format'
import { captureElementAsJPG, downloadElementAsPDF, downloadDataUrl, shareJPGOnWhatsApp, shareFileByEmail } from '../../lib/print'
import { Btn } from '../../components/ui'

// html2canvas 1.4.1 can't parse the oklch() color format Tailwind v4 uses
// by default for every color utility, so anything captured for
// Download/Email/WhatsApp uses plain hex inline styles instead of Tailwind
// color classes (layout/spacing utilities are unaffected and stay as-is).
const STONE = { 800: '#292524', 600: '#57534e', 500: '#78716c', 400: '#a8a29e', 300: '#d6d3d1', 200: '#e7e5e4' }
const TEAL = '#0D9488'

export default function OrderSlip({ order, onBack }) {
  const slipRef = useRef(null)
  const [busy, setBusy] = useState('') // "" | "download" | "email" | "share"
  const [toast, setToast] = useState('')

  const unit = order.unit || 'Mts'
  const totalRawQty = unit === 'Pcs' ? order.lines.reduce((s, l) => s + (Number(l.qty) || 0), 0) : order.total_mtrs

  const handlePrint = () => {
    try {
      window.print()
    } catch {
      setToast('This environment blocked the print dialog — try opening this in a regular browser tab.')
    }
  }
  const withCapture = (kind, run) => async () => {
    setBusy(kind)
    setToast('')
    try {
      const dataUrl = await captureElementAsJPG(slipRef.current)
      await run(dataUrl)
    } catch (e) {
      setToast(`${e?.message || 'Something went wrong.'} If this keeps happening, try opening this in a regular browser tab.`)
    } finally {
      setBusy('')
    }
  }
  const handleDownload = withCapture('download', async (dataUrl) => downloadDataUrl(dataUrl, `PO-${order.po_no}.jpg`))
  const handleDownloadPDF = async () => {
    setBusy('pdf')
    setToast('')
    try {
      await downloadElementAsPDF(slipRef.current, `PO-${order.po_no}.pdf`)
    } catch (e) {
      setToast(`${e?.message || 'Something went wrong.'} If this keeps happening, try opening this in a regular browser tab.`)
    } finally {
      setBusy('')
    }
  }
  // WhatsApp/email open a tab synchronously, before the (async) capture —
  // a tab opened after an await loses the click's "user activation" and
  // gets silently popup-blocked in most browsers. See lib/print.js.
  const handleShare = async () => {
    setBusy('share')
    setToast('')
    const win = window.open('', '_blank')
    try {
      const dataUrl = await captureElementAsJPG(slipRef.current)
      const result = await shareJPGOnWhatsApp(dataUrl, `PO-${order.po_no}.jpg`, `Production Order ${order.po_no} — ${order.design_label}`, win)
      if (result === 'fallback') setToast("Your browser can't attach the image automatically — it's downloaded, so just attach it in the WhatsApp chat that opened.")
    } catch (e) {
      win?.close()
      setToast(`${e?.message || 'Something went wrong.'} If this keeps happening, try opening this in a regular browser tab.`)
    } finally {
      setBusy('')
    }
  }
  const handleEmail = async () => {
    setBusy('email')
    setToast('')
    const win = window.open('', '_blank')
    try {
      const dataUrl = await captureElementAsJPG(slipRef.current)
      const result = await shareFileByEmail(dataUrl, `PO-${order.po_no}.jpg`, 'image/jpeg', `Production Order ${order.po_no}`, `Production Order ${order.po_no} — ${order.design_label}, for ${order.weaver_name}.`, win)
      if (result === 'fallback') setToast('The image is downloaded — attach it to the email draft that opened.')
    } catch (e) {
      win?.close()
      setToast(`${e?.message || 'Something went wrong.'} If this keeps happening, try opening this in a regular browser tab.`)
    } finally {
      setBusy('')
    }
  }

  const border = { border: `1px solid ${STONE[300]}` }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2 print:hidden">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium">
          <ArrowLeft size={15} /> Back to Production Orders
        </button>
        <div className="flex gap-2 flex-wrap">
          <Btn variant="ghost" onClick={handlePrint}>
            <Printer size={14} /> Print
          </Btn>
          <Btn variant="ghost" onClick={handleDownload} disabled={busy === 'download'}>
            {busy === 'download' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download JPG
          </Btn>
          <Btn variant="ghost" onClick={handleDownloadPDF} disabled={busy === 'pdf'}>
            {busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Download PDF
          </Btn>
          <Btn variant="ghost" onClick={handleEmail} disabled={busy === 'email'}>
            {busy === 'email' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />} Share on Email
          </Btn>
          <Btn onClick={handleShare} disabled={busy === 'share'}>
            {busy === 'share' ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Share on WhatsApp
          </Btn>
        </div>
      </div>
      {toast && <div className="text-xs mb-3 text-[#0D9488] print:hidden">{toast}</div>}

      <div
        id="order-slip-print"
        ref={slipRef}
        className="print-area rounded-md p-8 max-w-2xl mx-auto"
        style={{ backgroundColor: '#ffffff', border: `1px solid ${STONE[200]}`, color: STONE[800] }}
      >
        <div className="text-center mb-1">
          <div style={{ color: '#1C1917', fontFamily: 'var(--font-wordmark)', fontWeight: 700 }} className="text-2xl">
            SOUTH HANDLOOMS
          </div>
        </div>
        <div className="text-center text-xs mb-6" style={{ color: STONE[500] }}>
          37, Rajamannar Street, T.Nagar, Chennai - 600017 &nbsp;·&nbsp; 9003251000 &nbsp;·&nbsp; mail@southhandlooms.com
        </div>

        <div className="flex justify-between text-sm mb-6 gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: STONE[400] }}>
              To
            </div>
            <div className="font-semibold">{order.weaver_name}</div>
            {order.weaver_address && <div style={{ color: STONE[600] }}>{order.weaver_address}</div>}
            {order.weaver_whatsapp && <div style={{ color: STONE[600] }}>{order.weaver_whatsapp}</div>}
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: STONE[400] }}>
              Production Order
            </div>
            <div className="font-semibold">PO No {order.po_no}</div>
            <div style={{ color: STONE[600] }}>{fmtDateDMY(order.po_date)}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 text-xs mb-4 py-3" style={{ borderTop: `1px solid ${STONE[200]}`, borderBottom: `1px solid ${STONE[200]}` }}>
          <div>
            <div className="uppercase tracking-wide mb-0.5" style={{ color: STONE[400] }}>
              Design No
            </div>
            <div className="font-semibold">{order.design_no}</div>
          </div>
          <div>
            <div className="uppercase tracking-wide mb-0.5" style={{ color: STONE[400] }}>
              Width
            </div>
            <div className="font-semibold">{order.width}&quot;</div>
          </div>
          <div>
            <div className="uppercase tracking-wide mb-0.5" style={{ color: STONE[400] }}>
              Reed
            </div>
            <div className="font-semibold">{order.reed}</div>
          </div>
          <div>
            <div className="uppercase tracking-wide mb-0.5" style={{ color: STONE[400] }}>
              Base Pick
            </div>
            <div className="font-semibold">{order.pick}</div>
          </div>
          <div>
            <div className="uppercase tracking-wide mb-0.5" style={{ color: STONE[400] }}>
              Warp Yarn
            </div>
            <div className="font-semibold">{order.warp_yarn_type_name}</div>
          </div>
          <div>
            <div className="uppercase tracking-wide mb-0.5" style={{ color: STONE[400] }}>
              Warp Colour
            </div>
            <div className="font-semibold">{order.warp_colour_name}</div>
          </div>
        </div>

        {order.remarks && (
          <div className="text-xs mb-4">
            <span className="uppercase tracking-wide mr-1.5" style={{ color: STONE[400] }}>
              Remarks
            </span>
            <span className="font-semibold">{order.remarks}</span>
          </div>
        )}

        <table className="w-full text-sm mb-2" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className="px-3 py-1.5 font-bold" style={{ ...border, color: STONE[800] }}>
                SL
              </th>
              {order.feederQuality.map((f) => (
                <th key={f.feeder_no} className="px-3 py-1.5 font-bold" style={{ ...border, color: STONE[800] }}>
                  F{f.feeder_no}
                </th>
              ))}
              <th className="px-3 py-1.5 font-bold" style={{ ...border, color: STONE[800] }}>
                QTY ({unit.toUpperCase()})
              </th>
            </tr>
            <tr>
              <th className="px-3 py-1.5" style={border}></th>
              {order.feederQuality.map((f) => (
                <th key={f.feeder_no} className="px-3 py-1.5 font-bold" style={{ ...border, color: STONE[800] }}>
                  {f.yarn_type_name}
                </th>
              ))}
              <th className="px-3 py-1.5" style={border}></th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((line) => (
              <tr key={line.sl}>
                <td className="px-3 py-1.5 text-center font-medium" style={{ ...border, color: TEAL }}>
                  {line.sl}
                </td>
                {line.colours.map((c) => (
                  <td key={c.feeder_no} className="px-3 py-1.5 text-center font-medium" style={{ ...border, color: TEAL }}>
                    {c.colour_name}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-center" style={border}>
                  <div className="font-medium font-mono" style={{ color: TEAL }}>
                    {line.qty} {unit.toLowerCase()}
                  </div>
                  {unit === 'Pcs' && line.mts != null && (
                    <div className="text-xs font-mono" style={{ color: STONE[400] }}>
                      ({fmt(line.mts)} mts)
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="px-3 py-1.5 font-bold text-center" colSpan={2} style={{ ...border, color: STONE[800] }}>
                TOTAL
              </td>
              {order.feederQuality.slice(1).map((f) => (
                <td key={f.feeder_no} className="px-3 py-1.5" style={border}></td>
              ))}
              <td className="px-3 py-1.5 text-center" style={border}>
                <div className="font-bold font-mono" style={{ color: STONE[800] }}>
                  {fmt(totalRawQty)} {unit.toLowerCase()}
                </div>
                {unit === 'Pcs' && (
                  <div className="text-xs font-normal font-mono" style={{ color: STONE[400] }}>
                    ({fmt(order.total_mtrs)} mts)
                  </div>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
