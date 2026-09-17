// Indian financial year: 1 Apr - 31 Mar, labelled "2026-27" for the year
// starting April 2026. Mirrors get_fy() in the Supabase migration — kept
// in sync there since the FY is derived client-side for display too.
export function getFY(dateStr) {
  if (!dateStr) return null
  const [y, m] = dateStr.split('-').map(Number)
  if (!y || !m) return null
  const startYear = m >= 4 ? y : y - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

export function currentFYLabel() {
  return getFY(todayISO())
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
