import { useState } from 'react'
import { Printer, Pencil, Trash2, PackageMinus } from 'lucide-react'
import { fmt, fmtDateDMY } from '../../lib/format'
import { Card, Empty } from '../../components/ui'

export default function YarnIssueList({ issues, onDelete, onView, onEdit, canDelete, canEdit = true, emptyHint }) {
  const [confirmId, setConfirmId] = useState(null)
  const [error, setError] = useState('')

  if (issues.length === 0) {
    return (
      <Card>
        <Empty icon={PackageMinus} title="No yarn issues" hint={emptyHint} />
      </Card>
    )
  }

  const doDelete = async (id) => {
    const err = await onDelete(id)
    setConfirmId(null)
    if (err) setError(err)
  }

  return (
    <div>
      {error && <div className="text-xs mb-2 text-[#0D9488]">{error}</div>}
      <div className="flex flex-col gap-2">
        {issues.map((i) => (
          <Card key={i.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-y-2 gap-x-4">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-sm font-semibold text-stone-800">RMDC {i.issue_no}</span>
                <span style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }} className="px-2.5 py-0.5 rounded-full text-xs font-semibold">
                  {fmt(i.total_qty)} kg
                </span>
              </div>
              <div className="text-xs text-stone-500 mt-1">
                {i.weaver_name} · {fmtDateDMY(i.issue_date)} · ₹{fmt(i.total_amount)}
                {i.remarks && <> · {i.remarks}</>}
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              <button onClick={() => onView(i.id)} className="flex items-center gap-1 text-[#0D9488] hover:underline">
                <Printer size={13} /> View / Print
              </button>
              <button onClick={() => onEdit(i.id)} disabled={!canEdit} className="flex items-center gap-1 text-stone-500 hover:text-stone-700 disabled:opacity-40 disabled:cursor-not-allowed">
                <Pencil size={13} /> Edit
              </button>
              {canDelete &&
                (confirmId === i.id ? (
                  <span className="flex items-center gap-2">
                    <button onClick={() => doDelete(i.id)} className="font-semibold underline text-[#0D9488]">
                      Delete
                    </button>
                    <button onClick={() => setConfirmId(null)} className="font-semibold text-stone-500">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmId(i.id)} className="flex items-center gap-1 text-stone-400 hover:text-[#0D9488]">
                    <Trash2 size={13} /> Delete
                  </button>
                ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
