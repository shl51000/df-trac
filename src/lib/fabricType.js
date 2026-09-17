// A Design No's leading letters (e.g. "MS" in "MS-147") are matched
// against a Fabric Type's Code to work out what kind of fabric an
// order is, and which unit ("Mts"/"Pcs") its quantities are in.
export const getDesignPrefix = (designNo) => (String(designNo || '').match(/^[A-Za-z]+/) || [''])[0]

export function findFabricType(designNo, fabricTypes) {
  const prefix = getDesignPrefix(designNo).toUpperCase()
  if (!prefix) return null
  return fabricTypes.find((f) => f.code.trim().toUpperCase() === prefix) || null
}

// Falls back to "Mts" wherever no Fabric Type is set up yet for a prefix.
export const measuringTermFor = (designNo, fabricTypes) => findFabricType(designNo, fabricTypes)?.measuring_term || 'Mts'
