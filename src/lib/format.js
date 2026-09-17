export function fmt(n) {
  const v = Number(n) || 0
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}

export function fmtDateDMY(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}-${m}-${y}` : iso
}
