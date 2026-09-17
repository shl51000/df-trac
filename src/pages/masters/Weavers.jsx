import { useEffect, useState } from 'react'
import { Pencil, Plus, X, Trash2, MapPin, Phone, Mail, Users, Search, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import { friendlyError } from '../../lib/pgError'
import { useAuth } from '../../context/AuthContext'
import { Card, Label, Input, Btn, Empty, Header, IconBtn, Badge } from '../../components/ui'

export default function Weavers() {
  const { isAdmin } = useAuth()
  const [weavers, setWeavers] = useState(null)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const load = async () => {
    const { data } = await supabase.from('weavers').select('*').order('name')
    setWeavers(data ?? [])
  }
  useEffect(() => {
    load()
  }, [])

  const startEdit = (w) => {
    setEditingId(w.id)
    setName(w.name)
    setAddress(w.address || '')
    setWhatsapp(w.whatsapp || '')
    setEmail(w.email || '')
    setError('')
  }
  const cancelEdit = () => {
    setEditingId(null)
    setName('')
    setAddress('')
    setWhatsapp('')
    setEmail('')
    setError('')
  }

  const submit = async () => {
    const n = name.trim()
    if (!n) {
      setError('Weaver name is required.')
      return
    }
    const payload = { name: n, address: address.trim(), whatsapp: whatsapp.trim(), email: email.trim() }
    const { error } = editingId
      ? await supabase.from('weavers').update(payload).eq('id', editingId)
      : await supabase.from('weavers').insert(payload)
    if (error) {
      setError(friendlyError(error))
      return
    }
    cancelEdit()
    load()
  }

  const removeWeaver = async (id) => {
    const { error } = await supabase.from('weavers').delete().eq('id', id)
    setConfirmDeleteId(null)
    if (error) {
      setError(friendlyError(error, { onInUse: "Used in a Production Order — can't delete. Mark it inactive instead." }))
      return
    }
    load()
  }

  const toggleActive = async (w) => {
    await supabase.from('weavers').update({ is_active: !w.is_active }).eq('id', w.id)
    load()
  }

  if (weavers === null) return null

  const q = query.trim().toLowerCase()
  const visible = weavers
    .filter((w) => showInactive || w.is_active)
    .filter((w) => !q || `${w.name} ${w.address || ''} ${w.whatsapp || ''} ${w.email || ''}`.toLowerCase().includes(q))

  return (
    <div>
      <Header title="Weavers" subtitle="Weaver name, address, WhatsApp number and email — used when creating Production Orders." />

      <Card className="p-5 max-w-lg mb-6">
        <Label>{editingId ? 'Edit weaver' : 'Add weaver'}</Label>
        <div className="grid gap-3">
          <div>
            <Label>Weaver name</Label>
            <Input
              placeholder="e.g. Murugan Weaves"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
            />
          </div>
          <div>
            <Label>Address (optional)</Label>
            <Input placeholder="e.g. 12 Weavers Colony, Kanchipuram" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>WhatsApp number (optional)</Label>
              <Input placeholder="e.g. 9876543210" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            </div>
            <div>
              <Label>Email (optional)</Label>
              <Input type="email" placeholder="optional" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
        </div>
        {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
        <div className="pt-4 mt-1 border-t border-stone-200 flex gap-2">
          <Btn onClick={submit}>
            {editingId ? <Pencil size={15} /> : <Plus size={15} />} {editingId ? 'Update' : 'Add'} weaver
          </Btn>
          {editingId && (
            <Btn variant="ghost" onClick={cancelEdit}>
              <X size={15} /> Cancel
            </Btn>
          )}
        </div>
      </Card>

      {weavers.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <div className="relative max-w-sm flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <Input placeholder="Search weavers…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
      )}

      <Card>
        {weavers.length === 0 ? (
          <Empty icon={Users} title="No weavers yet" hint="Add your first weaver above." />
        ) : visible.length === 0 ? (
          <Empty icon={Search} title="No matches" hint="Try a different search term, or show inactive weavers." />
        ) : (
          <div className="divide-y divide-stone-100">
            {visible.map((w) => (
              <div key={w.id} className="px-4 py-3 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-stone-800">{w.name}</span>
                    {!w.is_active && <Badge tone="neutral">Inactive</Badge>}
                  </div>
                  {(w.address || w.whatsapp || w.email) && (
                    <div className="text-xs text-stone-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      {w.address && (
                        <span className="flex items-center gap-1">
                          <MapPin size={11} />
                          {w.address}
                        </span>
                      )}
                      {w.whatsapp && (
                        <span className="flex items-center gap-1">
                          <Phone size={11} />
                          {w.whatsapp}
                        </span>
                      )}
                      {w.email && (
                        <span className="flex items-center gap-1">
                          <Mail size={11} />
                          {w.email}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <IconBtn title={w.is_active ? 'Mark inactive' : 'Mark active'} onClick={() => toggleActive(w)}>
                    <EyeOff size={14} />
                  </IconBtn>
                  <IconBtn title="Edit" onClick={() => startEdit(w)}>
                    <Pencil size={14} />
                  </IconBtn>
                  {isAdmin &&
                    (confirmDeleteId === w.id ? (
                      <div className="flex items-center gap-2 text-xs">
                        <button onClick={() => removeWeaver(w.id)} className="font-semibold underline text-[#0D9488]">
                          Delete
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} className="font-semibold text-stone-500">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <IconBtn title="Delete" danger onClick={() => setConfirmDeleteId(w.id)}>
                        <Trash2 size={14} />
                      </IconBtn>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
