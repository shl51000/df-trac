export const FEEDER_COUNT = 8

// A feeder counts as "active" only when its Card is a real value — blank,
// "-", and "0" all mean "not used".
export const isActiveCard = (card) => {
  const c = String(card || '').trim()
  return c !== '' && c !== '-' && c !== '0'
}

export const emptyFeeders = () => Array.from({ length: FEEDER_COUNT }, () => ({ card: '', picks: {} }))

export const computeAveragePick = (feeders, pickValue) =>
  feeders.reduce((sum, f) => sum + (Number(f.picks?.[pickValue]) || 0), 0)

// Cut Size is a design-level field (same for every feeder), used both for
// a Production Order's headline Mts total and, in Yarn Required, for each
// feeder's own consumption — same single figure either way.
export const designCutSize = (design) => Number(design?.cut_size) || 1

export const lineMtsEquivalent = (qty, unit, cutSize) => {
  const q = Number(qty) || 0
  return unit === 'Pcs' ? q * cutSize : q
}

export function fmt2(n) {
  const v = Number(n) || 0
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
}
