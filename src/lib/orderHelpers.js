import { fmt } from './format'

export const ORDER_SORTS = {
  dateNewest: { label: 'Date (newest)', fn: (a, b) => b.po_date.localeCompare(a.po_date) },
  dateOldest: { label: 'Date (oldest)', fn: (a, b) => a.po_date.localeCompare(b.po_date) },
  poNoAsc: {
    label: 'PO No (low–high)',
    fn: (a, b) => {
      const na = parseFloat(a.po_no)
      const nb = parseFloat(b.po_no)
      return !isNaN(na) && !isNaN(nb) ? na - nb : a.po_no.localeCompare(b.po_no)
    },
  },
  designAsc: { label: 'Design No (A–Z)', fn: (a, b) => a.design_no.localeCompare(b.design_no) },
}

export const STATUS_FILTERS = { pending: 'Pending', closed: 'Closed', 'short-closed': 'Short-Closed', all: 'All statuses' }

export const orderStatus = (o) => o.status || 'pending'

// Primary qty for a PO: Pcs with the auto Mts alongside for a Pcs-measured
// order, otherwise just Mts. `totalPcs` is the sum of that order's own
// lines' qty — pass it in since it needs a separate fetch.
export function formatOrderQty(order, totalPcs) {
  if (order.unit === 'Pcs') return `${fmt(totalPcs)} pcs (${fmt(order.total_mtrs)} mts)`
  return `${fmt(order.total_mtrs)} mts`
}

export const orderMatchesQuery = (o, q) => {
  if (!q) return true
  const hay = `${o.po_no} ${o.design_no} ${o.design_label} ${o.weaver_name} ${o.warp_yarn_type_name || ''} ${o.warp_colour_name || ''} ${o.remarks || ''}`.toLowerCase()
  return hay.includes(q)
}

// `.mts` is the metres-equivalent (raw qty for an Mts receipt, Pcs × Cut
// Size for a Pcs one) — always compare like-for-like against a PO's own
// total_mtrs.
export const receivedQtyForOrder = (poId, receipts) => receipts.filter((r) => r.po_id === poId).reduce((sum, r) => sum + (Number(r.mts) || 0), 0)

// `.qty` is what was actually typed into the receipt form, in the order's
// own unit (Goods Receipt always saves a receipt in its PO's unit) —
// unlike receivedQtyForOrder's mts-equivalent, this is what an
// "Ordered/Received/Balance" summary should show for a Pcs-unit order, so
// it reads "164 pcs" rather than its auto-converted mts figure.
export const nativeReceivedQtyForOrder = (poId, receipts) => receipts.filter((r) => r.po_id === poId).reduce((sum, r) => sum + (Number(r.qty) || 0), 0)

// Ordered qty in the order's own unit — the counterpart to
// nativeReceivedQtyForOrder. `totalPcs` is the sum of that order's own
// lines' qty for a Pcs-unit order (needs a separate fetch), unused for Mts.
export const nativeOrderedQty = (order, totalPcs) => (order.unit === 'Pcs' ? Number(totalPcs) || 0 : Number(order.total_mtrs) || 0)
