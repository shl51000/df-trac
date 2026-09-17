// Turns common Postgres/PostgREST error codes into the same kind of
// plain-English message the prototype showed inline under a form.
export function friendlyError(error, { onDuplicate, onInUse } = {}) {
  if (!error) return ''
  if (error.code === '23505') return onDuplicate || 'That value is already in use — enter a different one.'
  if (error.code === '23503') return onInUse || "Can't delete this — it's used elsewhere."
  return error.message || 'Something went wrong.'
}
