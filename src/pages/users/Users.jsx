import { useEffect, useState } from 'react'
import { Pencil, X, KeyRound, Download, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { downloadJSON } from '../../lib/print'
import { buildBackup } from '../../lib/backup'
import { todayISO } from '../../lib/fy'
import { useAuth } from '../../context/AuthContext'
import { Card, Label, Input, Select, Btn, Empty, Header, IconBtn } from '../../components/ui'

export default function Users() {
  const { user, isAdmin } = useAuth()
  const [profiles, setProfiles] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [role, setRole] = useState('user')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [backingUp, setBackingUp] = useState(false)
  const [backupError, setBackupError] = useState('')

  const load = async () => {
    const { data } = await supabase.from('profiles').select('*').order('name')
    setProfiles(data ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  const startEdit = (p) => {
    setEditingId(p.id)
    setName(p.name)
    setMobile(p.mobile || '')
    setRole(p.role)
    setError('')
  }
  const cancelEdit = () => {
    setEditingId(null)
    setName('')
    setMobile('')
    setRole('user')
    setError('')
  }

  const submit = async () => {
    const n = name.trim()
    if (!n) return setError('Name is required.')
    setSaving(true)
    const payload = { name: n, mobile: mobile.trim() }
    if (isAdmin) payload.role = role
    const { error: updErr } = await supabase.from('profiles').update(payload).eq('id', editingId)
    setSaving(false)
    if (updErr) return setError(friendlyError(updErr))
    cancelEdit()
    load()
  }

  const downloadBackup = async () => {
    setBackingUp(true)
    setBackupError('')
    try {
      const backup = await buildBackup()
      downloadJSON(`df-trac-backup-${todayISO()}.json`, backup)
    } catch (e) {
      setBackupError(e?.message || 'Something went wrong building the backup.')
    } finally {
      setBackingUp(false)
    }
  }

  if (profiles === null) return null

  return (
    <div>
      <Header title="Users" subtitle="Everyone who can sign in — name, mobile and role. New accounts are created directly in Supabase; promote one to admin here." />

      {isAdmin && (
        <Card className="p-5 max-w-lg mb-6">
          <Label>Data backup</Label>
          <p className="text-xs text-stone-500 mb-3">
            Downloads every master and transaction record — weavers, designs, production orders, goods receipts, yarn issues, and more — as one JSON file
            you keep for yourself. Uploaded spec-sheet and PO-screenshot photos aren't included, only the data rows.
          </p>
          {backupError && <div className="text-xs mb-2 text-[#0D9488]">{backupError}</div>}
          <Btn variant="ghost" onClick={downloadBackup} disabled={backingUp}>
            {backingUp ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {backingUp ? 'Preparing…' : 'Download backup'}
          </Btn>
        </Card>
      )}

      {editingId && (
        <Card className="p-5 max-w-lg mb-6">
          <Label>Edit user</Label>
          <div className="grid gap-3">
            <div>
              <Label>Name</Label>
              <Input
                placeholder="e.g. Priya Kumar"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setError('')
                }}
              />
            </div>
            <div>
              <Label>Mobile number</Label>
              <Input placeholder="e.g. 9876543210" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </div>
            {isAdmin && (
              <div>
                <Label>Role</Label>
                <Select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
            )}
          </div>
          {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
          <div className="pt-4 mt-1 border-t border-stone-200 flex gap-2">
            <Btn onClick={submit} disabled={saving}>
              <Pencil size={15} /> {saving ? 'Saving…' : 'Save changes'}
            </Btn>
            <Btn variant="ghost" onClick={cancelEdit} disabled={saving}>
              <X size={15} /> Cancel
            </Btn>
          </div>
        </Card>
      )}

      <Card>
        {profiles.length === 0 ? (
          <Empty icon={KeyRound} title="No users found" />
        ) : (
          <div className="divide-y divide-stone-100">
            {profiles.map((p) => {
              const canEdit = isAdmin || p.id === user.id
              return (
                <div key={p.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-stone-800">{p.name}</span>
                      {p.id === user.id && <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wide">You</span>}
                      <span
                        style={p.role === 'admin' ? { backgroundColor: '#F0FDFA', color: '#0F766E' } : {}}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${p.role === 'admin' ? '' : 'bg-stone-100 text-stone-600'}`}
                      >
                        {p.role === 'admin' ? 'Admin' : 'User'}
                      </span>
                    </div>
                    {p.mobile && <div className="text-xs text-stone-500 mt-0.5">{p.mobile}</div>}
                  </div>
                  {canEdit && (
                    <IconBtn title="Edit" onClick={() => startEdit(p)}>
                      <Pencil size={14} />
                    </IconBtn>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
