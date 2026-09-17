// Users only ever type the number; the unit suffix is fixed in the UI and
// re-applied on save. Mirrors stripSuffix/withSuffix in the prototype.
const stripSuffix = (v, letter) => String(v || '').trim().replace(new RegExp(`\\s*${letter}$`, 'i'), '').trim()
const withSuffix = (v, letter) => {
  const n = stripSuffix(v, letter)
  return n ? `${n}${letter}` : ''
}

export const stripDenierSuffix = (d) => stripSuffix(d, 'D')
export const withDenierSuffix = (d) => withSuffix(d, 'D')
export const stripReedSuffix = (r) => stripSuffix(r, 'r')
export const withReedSuffix = (r) => withSuffix(r, 'r')
export const stripPickSuffix = (p) => stripSuffix(p, 'p')
export const withPickSuffix = (p) => withSuffix(p, 'p')
