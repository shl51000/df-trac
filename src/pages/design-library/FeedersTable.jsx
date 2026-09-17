import { Card, Input } from '../../components/ui'
import { computeAveragePick, fmt2 } from '../../lib/design'
import { withPickSuffix } from '../../lib/suffix'

// feeders: [{ card, picks: { [pickValue]: string } }] × 8 — shared shape
// for both the multi-pick create form and the single-pick edit form.
// `labels` optionally maps a pickValue key to its displayed column header —
// the edit form uses a stable internal key that's decoupled from the Pick
// field's live text, so editing Pick doesn't disconnect already-entered
// feeder values from their column.
export default function FeedersTable({ feeders, pickValues, onUpdateCard, onUpdatePick, labels }) {
  return (
    <Card className="mb-5">
      <div className="px-4 py-3 border-b border-stone-200">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-700">Feeders</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[440px]">
          <thead>
            <tr className="text-stone-400 text-xs">
              <th className="text-left font-semibold px-4 py-2">Feeder</th>
              <th className="text-left font-semibold px-2 py-2">Card</th>
              {pickValues.map((v) => (
                <th key={v} className="text-right font-semibold px-3 py-2">
                  {labels?.[v] ?? withPickSuffix(v)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {feeders.map((f, idx) => (
              <tr key={idx} className="border-t border-stone-100">
                <td className="px-4 py-1.5 text-stone-500 font-mono">F{idx + 1}</td>
                <td className="px-2 py-1.5 w-28">
                  <Input value={f.card} onChange={(e) => onUpdateCard(idx, e.target.value)} placeholder="—" />
                </td>
                {pickValues.map((v) => (
                  <td key={v} className="px-3 py-1.5 w-24">
                    <Input
                      className="text-right"
                      value={f.picks[v] || ''}
                      onChange={(e) => onUpdatePick(idx, v, e.target.value)}
                      placeholder="0.00"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-stone-200">
              <td className="px-4 py-2 text-xs font-semibold text-stone-500" colSpan={2}>
                Average pick (total of feeder picks)
              </td>
              {pickValues.map((v) => (
                <td key={v} className="px-3 py-2 text-right text-sm font-semibold text-stone-800 font-mono">
                  {fmt2(computeAveragePick(feeders, v))}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  )
}
