import { useRef, useState } from 'react'
import { ArrowLeft, Printer, Download, Mail, Share2, Loader2 } from 'lucide-react'
import { fmt, fmtDateDMY } from '../../lib/format'
import { captureElementAsJPG, downloadDataUrl, shareJPGOnWhatsApp, shareFileByEmail } from '../../lib/print'
import { Btn } from '../../components/ui'

// Same html2canvas + Tailwind v4 oklch() incompatibility as OrderSlip —
// the captured element uses plain hex inline styles, never Tailwind color
// classes. See src/pages/production-orders/OrderSlip.jsx for the full note.
const STONE = { 800: '#292524', 600: '#57534e', 500: '#78716c', 400: '#a8a29e', 300: '#d6d3d1', 200: '#e7e5e4' }
const TEAL = '#0D9488'

export default function IssueSlip({ issue, onBack }) {
  const slipRef = useRef(null)
  const [busy, setBusy] = useState('') // "" | "download" | "email" | "share"
  const [toast, setToast] = useState('')

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
  const handleDownload = withCapture('download', async (dataUrl) => downloadDataUrl(dataUrl, `RMDC-${issue.issue_no}.jpg`))
  // WhatsApp/email open a tab synchronously, before the (async) capture —
  // a tab opened after an await loses the click's "user activation" and
  // gets silently popup-blocked in most browsers. See lib/print.js.
  const handleShare = async () => {
    setBusy('share')
    setToast('')
    const win = window.open('', '_blank')
    try {
      const dataUrl = await captureElementAsJPG(slipRef.current)
      const result = await shareJPGOnWhatsApp(dataUrl, `RMDC-${issue.issue_no}.jpg`, `RMDC ${issue.issue_no} — yarn issued to ${issue.weaver_name}`, win)
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
      const result = await shareFileByEmail(dataUrl, `RMDC-${issue.issue_no}.jpg`, 'image/jpeg', `RMDC ${issue.issue_no}`, `RMDC ${issue.issue_no} — yarn issued to ${issue.weaver_name}.`, win)
      if (result === 'fallback') setToast('The image is downloaded — attach it to the email draft that opened.')
    } catch (e) {
      win?.close()
      setToast(`${e?.message || 'Something went wrong.'} If this keeps happening, try opening this in a regular browser tab.`)
    } finally {
      setBusy('')
    }
  }

  const border = { border: `1px solid ${STONE[300]}` }
  const hasDispatch = issue.supplier_name || issue.transport_name || issue.lr_no || issue.lr_date || issue.payment_term

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2 print:hidden">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-[#0D9488] font-medium">
          <ArrowLeft size={15} /> Back to Yarn Issue
        </button>
        <div className="flex gap-2 flex-wrap">
          <Btn variant="ghost" onClick={handlePrint}>
            <Printer size={14} /> Print
          </Btn>
          <Btn variant="ghost" onClick={handleDownload} disabled={busy === 'download'}>
            {busy === 'download' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download JPG
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
        id="issue-slip-print"
        ref={slipRef}
        className="print-area rounded-md p-8 max-w-2xl mx-auto"
        style={{ backgroundColor: '#ffffff', border: `1px solid ${STONE[200]}`, color: STONE[800] }}
      >
        <div className="text-center mb-1">
          <div style={{ color: '#1C1917', fontFamily: 'var(--font-wordmark)' }} className="text-2xl">
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
            <div className="font-semibold">{issue.weaver_name}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[11px] uppercase tracking-wide mb-1" style={{ color: STONE[400] }}>
              Yarn Issue
            </div>
            <div className="font-semibold">RMDC No {issue.issue_no}</div>
            <div style={{ color: STONE[600] }}>{fmtDateDMY(issue.issue_date)}</div>
          </div>
        </div>

        {issue.remarks && (
          <div className="text-xs mb-4">
            <span className="uppercase tracking-wide mr-1.5" style={{ color: STONE[400] }}>
              Remarks
            </span>
            <span className="font-semibold">{issue.remarks}</span>
          </div>
        )}

        {hasDispatch && (
          <div className="grid grid-cols-3 gap-3 text-xs mb-4 py-3" style={{ borderTop: `1px solid ${STONE[200]}`, borderBottom: `1px solid ${STONE[200]}` }}>
            {issue.supplier_name && (
              <div>
                <div className="uppercase tracking-wide mb-0.5" style={{ color: STONE[400] }}>
                  Supplier
                </div>
                <div className="font-semibold">{issue.supplier_name}</div>
              </div>
            )}
            {issue.transport_name && (
              <div>
                <div className="uppercase tracking-wide mb-0.5" style={{ color: STONE[400] }}>
                  Transport
                </div>
                <div className="font-semibold">{issue.transport_name}</div>
              </div>
            )}
            {issue.lr_no && (
              <div>
                <div className="uppercase tracking-wide mb-0.5" style={{ color: STONE[400] }}>
                  LR No.
                </div>
                <div className="font-semibold">{issue.lr_no}</div>
              </div>
            )}
            {issue.lr_date && (
              <div>
                <div className="uppercase tracking-wide mb-0.5" style={{ color: STONE[400] }}>
                  LR Date
                </div>
                <div className="font-semibold">{fmtDateDMY(issue.lr_date)}</div>
              </div>
            )}
            {issue.payment_term && (
              <div>
                <div className="uppercase tracking-wide mb-0.5" style={{ color: STONE[400] }}>
                  Payment
                </div>
                <div className="font-semibold">{issue.payment_term}</div>
              </div>
            )}
          </div>
        )}

        <table className="w-full text-sm mb-2" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th className="px-2 py-1.5 font-bold" style={{ ...border, color: STONE[800] }}>
                SL
              </th>
              <th className="px-2 py-1.5 font-bold" style={{ ...border, color: STONE[800] }}>
                Name of Yarn
              </th>
              <th className="px-2 py-1.5 font-bold" style={{ ...border, color: STONE[800] }}>
                Colour / Shade
              </th>
              <th className="px-2 py-1.5 font-bold text-right" style={{ ...border, color: STONE[800] }}>
                Qty (kg)
              </th>
              <th className="px-2 py-1.5 font-bold text-right" style={{ ...border, color: STONE[800] }}>
                Rate
              </th>
              <th className="px-2 py-1.5 font-bold text-right" style={{ ...border, color: STONE[800] }}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {issue.items.map((it) => (
              <tr key={it.sl}>
                <td className="px-2 py-1 text-center" style={{ ...border, color: TEAL }}>
                  {it.sl}
                </td>
                <td className="px-2 py-1" style={border}>
                  {it.yarn_type_name}
                </td>
                <td className="px-2 py-1" style={border}>
                  {it.colour_name}
                </td>
                <td className="px-2 py-1 text-right font-mono" style={border}>
                  {fmt(it.qty)}
                </td>
                <td className="px-2 py-1 text-right font-mono" style={border}>
                  {fmt(it.rate)}
                </td>
                <td className="px-2 py-1 text-right font-mono" style={border}>
                  {fmt(it.amount)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="px-2 py-1.5 text-right font-bold" colSpan={3} style={{ ...border, color: STONE[800] }}>
                Total
              </td>
              <td className="px-2 py-1.5 text-right font-bold font-mono" style={{ ...border, color: STONE[800] }}>
                {fmt(issue.total_qty)}
              </td>
              <td style={border}></td>
              <td className="px-2 py-1.5 text-right font-bold font-mono" style={{ ...border, color: STONE[800] }}>
                {fmt(issue.total_amount)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
