import { useState } from 'react'
import { Printer, Pencil, Trash2, FileText } from 'lucide-react'
import { fmtDateDMY } from '../../lib/format'
import { formatOrderQty, orderStatus } from '../../lib/orderHelpers'
import { Card, Empty, StatusBadge } from '../../components/ui'

export default function ProductionOrdersList({ orders, pcsTotals, onDelete, onView, onEdit, canDelete, canEdit = true, emptyHint }) {
  const [confirmId, setConfirmId] = useState(null)
  const [error, setError] = useState('')

  if (orders.length === 0) {
    return (
      <Card>
        <Empty icon={FileText} title="No orders" hint={emptyHint} />
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
        {orders.map((o) => (
          <Card key={o.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-y-2 gap-x-4">
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-sm font-semibold text-stone-800">PO {o.po_no}</span>
                <span style={{ backgroundColor: '#F0FDFA', color: '#0F766E' }} className="px-2.5 py-0.5 rounded-full text-xs font-semibold">
                  {o.design_label}
                </span>
                <StatusBadge status={orderStatus(o)} />
              </div>
              <div className="text-xs text-stone-500 mt-1">
                {o.weaver_name} · {fmtDateDMY(o.po_date)} · {formatOrderQty(o, pcsTotals[o.id])} · {o.warp_yarn_type_name} ({o.warp_colour_name})
                {o.remarks && <> · {o.remarks}</>}
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              <button onClick={() => onView(o.id)} className="flex items-center gap-1 text-[#0D9488] hover:underline">
                <Printer size={13} /> View / Print
              </button>
              <button onClick={() => onEdit(o.id)} disabled={!canEdit} className="flex items-center gap-1 text-stone-500 hover:text-stone-700 disabled:opacity-40 disabled:cursor-not-allowed">
                <Pencil size={13} /> Edit
              </button>
              {canDelete &&
                (confirmId === o.id ? (
                  <span className="flex items-center gap-2">
                    <button onClick={() => doDelete(o.id)} className="font-semibold underline text-[#0D9488]">
                      Delete
                    </button>
                    <button onClick={() => setConfirmId(null)} className="font-semibold text-stone-500">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmId(o.id)} className="flex items-center gap-1 text-stone-400 hover:text-[#0D9488]">
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
