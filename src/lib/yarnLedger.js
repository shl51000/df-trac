// Builds a Colour Ledger drill-down (opening balance carried forward from
// every prior FY + this FY's Required/Issued sources + the resulting
// closing balance) for one Yarn Type + Colour, optionally scoped to one
// weaver. Shared by Yarn Required and Stock-in-Hand so the two never
// disagree — callers pass in data already scoped to `currentFY`
// (`ledgerRows` from v_yarn_ledger, `requirementRows` from
// v_po_yarn_requirement, `issuesInFY`/`issueItems` from yarn_issues(_items)).
export function buildColourLedger({ ledgerRows, requirementRows, issuesInFY, issueItems, weaverFilter, currentFY, yarnTypeId, colourId, yarnTypeName, colourName, reportDate }) {
  const scopedLedgerRows = ledgerRows.filter((r) => r.yarn_type_id === yarnTypeId && r.colour_id === colourId && (!weaverFilter || r.weaver_id === weaverFilter))
  const openingBalance = scopedLedgerRows.reduce((s, r) => s + (Number(r.opening_balance) || 0), 0)

  const requiredSources = Object.values(
    requirementRows
      .filter((r) => r.yarn_type_id === yarnTypeId && r.colour_id === colourId && (!weaverFilter || r.weaver_id === weaverFilter))
      .reduce((acc, r) => {
        const cur = acc[r.production_order_id] ?? { poId: r.production_order_id, poNo: r.po_no, poDate: r.po_date, kg: 0 }
        cur.kg += Number(r.kg) || 0
        acc[r.production_order_id] = cur
        return acc
      }, {})
  )

  const scopedIssueIds = new Set(issuesInFY.filter((i) => !weaverFilter || i.weaver_id === weaverFilter).map((i) => i.id))
  const issuesById = Object.fromEntries(issuesInFY.map((i) => [i.id, i]))
  const issuedSources = Object.values(
    issueItems
      .filter((it) => scopedIssueIds.has(it.yarn_issue_id) && it.yarn_type_id === yarnTypeId && it.colour_id === colourId)
      .reduce((acc, it) => {
        const issue = issuesById[it.yarn_issue_id]
        const cur = acc[it.yarn_issue_id] ?? { issueId: it.yarn_issue_id, issueNo: issue.issue_no, issueDate: issue.issue_date, kg: 0 }
        cur.kg += Number(it.qty) || 0
        acc[it.yarn_issue_id] = cur
        return acc
      }, {})
  )

  const requiredThisFY = requiredSources.reduce((s, r) => s + r.kg, 0)
  const issuedThisFY = issuedSources.reduce((s, r) => s + r.kg, 0)

  return {
    yarnTypeName,
    colourName,
    fy: currentFY,
    reportDate,
    openingBalance,
    requiredThisFY,
    issuedThisFY,
    closingBalance: openingBalance + requiredThisFY - issuedThisFY,
    requiredSources,
    issuedSources,
  }
}
