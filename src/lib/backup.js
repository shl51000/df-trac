import { supabase } from './supabaseClient'

// Every business-data table, as a full snapshot for the user's own
// safekeeping. Deliberately excludes `audit_log` (a security trail, not
// data you'd restore from, and it only grows) and doesn't touch Storage —
// uploaded spec-sheet/PO-screenshot photos live there, not in these rows,
// and aren't included in this export.
const TABLES = [
  'weavers',
  'yarn_types',
  'yarn_colours',
  'fabric_types',
  'designs',
  'design_feeders',
  'design_sheets',
  'production_orders',
  'production_order_feeder_quality',
  'production_order_lines',
  'production_order_line_colours',
  'goods_receipts',
  'yarn_issues',
  'yarn_issue_items',
  'yarn_opening_balances',
  'financial_years',
  'app_settings',
  'profiles',
]

// Fetches every table above and returns one plain object shaped
// { exportedAt, tables: { <table>: [...rows] } } — ready to hand to
// downloadJSON. Throws with the first table that failed, if any did.
export async function buildBackup() {
  const results = await Promise.all(TABLES.map((t) => supabase.from(t).select('*')))
  const tables = {}
  results.forEach(({ data, error }, i) => {
    if (error) throw new Error(`Couldn't read "${TABLES[i]}": ${error.message}`)
    tables[TABLES[i]] = data ?? []
  })
  return { exportedAt: new Date().toISOString(), tables }
}
