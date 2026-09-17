export const ISSUE_SORTS = {
  dateNewest: { label: 'RMDC Date (newest)', fn: (a, b) => b.issue_date.localeCompare(a.issue_date) },
  dateOldest: { label: 'RMDC Date (oldest)', fn: (a, b) => a.issue_date.localeCompare(b.issue_date) },
  issueNoAsc: { label: 'RMDC No (A–Z)', fn: (a, b) => a.issue_no.localeCompare(b.issue_no) },
}

export const issueMatchesQuery = (i, q) => `${i.issue_no} ${i.weaver_name}`.toLowerCase().includes(q)

export const PAYMENT_TERMS = ['To-Pay', 'Paid']
