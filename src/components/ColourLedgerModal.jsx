import { X } from 'lucide-react'
import { fmt, fmtDateDMY } from '../lib/format'

// Drill-down for one Yarn Type + Colour — every order that required it and
// every RMDC that issued it (this FY only), plus the opening balance
// brought forward from every prior FY and the resulting closing balance.
export default function ColourLedgerModal({ ledger, onClose }) {
  const rowCount = Math.max(ledger.requiredSources.length, ledger.issuedSources.length, 1)
  const closingLabel = ledger.closingBalance > 0 ? 'Yarn Required' : 'Excess in Hand'
  const closingValue = Math.abs(ledger.closingBalance)
  const closingColor = ledger.closingBalance > 0 ? '#DC2626' : '#16A34A'
  const openingLabel = ledger.openingBalance > 0 ? 'Required b/f' : ledger.openingBalance < 0 ? 'Excess b/f' : '—'
  const openingColor = ledger.openingBalance > 0 ? '#DC2626' : ledger.openingBalance < 0 ? '#16A34A' : '#78716C'
  const fyStartYear = ledger.fy.split('-')[0]
  const openingAsOn = `1 April ${fyStartYear}`
  const reportAsOn = fmtDateDMY(ledger.reportDate)

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200 shrink-0">
          <div>
            <div className="text-sm font-semibold text-stone-800">{ledger.yarnTypeName}</div>
            <div className="text-xs text-stone-500">
              {ledger.colourName} · FY {ledger.fy}
            </div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-auto px-5 py-4">
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th colSpan={6} className="border border-stone-300 px-2 py-1.5 text-left font-semibold text-stone-600" style={{ backgroundColor: '#FAFAF9' }}>
                  Opening Balance (brought forward) as on {openingAsOn}:{' '}
                  <span className="font-bold font-mono" style={{ color: openingColor }}>
                    {openingLabel}
                    {ledger.openingBalance !== 0 && ` ${fmt(Math.abs(ledger.openingBalance))}`}
                  </span>
                </th>
              </tr>
              <tr>
                <th colSpan={3} className="border border-stone-300 px-2 py-1.5 text-center font-bold text-stone-800" style={{ backgroundColor: '#F0FDFA' }}>
                  Required — FY {ledger.fy}
                </th>
                <th colSpan={3} className="border border-stone-300 px-2 py-1.5 text-center font-bold text-stone-800" style={{ backgroundColor: '#EFF6FF' }}>
                  Issued — FY {ledger.fy}
                </th>
              </tr>
              <tr className="text-xs text-stone-500">
                <th className="border border-stone-300 px-2 py-1.5 text-left">PO No</th>
                <th className="border border-stone-300 px-2 py-1.5 text-left">PO Date</th>
                <th className="border border-stone-300 px-2 py-1.5 text-right">Qty</th>
                <th className="border border-stone-300 px-2 py-1.5 text-left">RMDC No</th>
                <th className="border border-stone-300 px-2 py-1.5 text-left">RMDC Date</th>
                <th className="border border-stone-300 px-2 py-1.5 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rowCount }).map((_, i) => {
                const req = ledger.requiredSources[i]
                const iss = ledger.issuedSources[i]
                return (
                  <tr key={i}>
                    <td className="border border-stone-300 px-2 py-1 text-stone-700">{req ? `PO ${req.poNo}` : ''}</td>
                    <td className="border border-stone-300 px-2 py-1 text-stone-700">{req ? fmtDateDMY(req.poDate) : ''}</td>
                    <td className="border border-stone-300 px-2 py-1 text-right font-mono text-stone-700">{req ? fmt(req.kg) : ''}</td>
                    <td className="border border-stone-300 px-2 py-1 text-stone-700">{iss ? `RMDC ${iss.issueNo}` : ''}</td>
                    <td className="border border-stone-300 px-2 py-1 text-stone-700">{iss ? fmtDateDMY(iss.issueDate) : ''}</td>
                    <td className="border border-stone-300 px-2 py-1 text-right font-mono text-stone-700">{iss ? fmt(iss.kg) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="border border-stone-300 px-2 py-1.5 text-right font-semibold text-stone-600">
                  Total
                </td>
                <td className="border border-stone-300 px-2 py-1.5 text-right font-semibold font-mono text-stone-800">{fmt(ledger.requiredThisFY)}</td>
                <td colSpan={2} className="border border-stone-300 px-2 py-1.5 text-right font-semibold text-stone-600">
                  Total
                </td>
                <td className="border border-stone-300 px-2 py-1.5 text-right font-semibold font-mono text-stone-800">{fmt(ledger.issuedThisFY)}</td>
              </tr>
              <tr>
                <td colSpan={5} className="border border-stone-300 px-2 py-1.5 text-right font-bold text-stone-800">
                  Closing Balance — {closingLabel} as on {reportAsOn}
                </td>
                <td className="border border-stone-300 px-2 py-1.5 text-right font-bold font-mono" style={{ color: closingColor }}>
                  {fmt(closingValue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}
