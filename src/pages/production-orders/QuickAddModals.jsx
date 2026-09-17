import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import { Label, Input, SuffixedInput, Btn } from '../../components/ui'

// Used from New/Edit Production Order so a missing master record never has
// to send anyone off to another tab mid-form. Each modal's onCreate returns
// an error string to keep it open, or null on success (the caller closes
// it and applies the new id to whichever select triggered it).
function QuickAddModal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg max-w-sm w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-stone-800">{title}</span>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function QuickAddYarnTypeModal({ onClose, onCreate }) {
  const [name, setName] = useState('')
  const [denier, setDenier] = useState('')
  const [error, setError] = useState('')
  const submit = async () => {
    if (!name.trim()) return setError('Name is required.')
    if (!denier.trim()) return setError('Denier is required.')
    const err = await onCreate(name.trim(), denier.trim())
    if (err) setError(err)
  }
  return (
    <QuickAddModal title="Add yarn quality" onClose={onClose}>
      <div className="grid gap-3">
        <div>
          <Label>Name of yarn</Label>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError('')
            }}
            placeholder="e.g. Viscose Filament"
          />
        </div>
        <div>
          <Label>Denier</Label>
          <SuffixedInput
            suffix="D"
            value={denier}
            onChange={(e) => {
              setDenier(e.target.value)
              setError('')
            }}
            placeholder="e.g. 150"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </div>
      </div>
      {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
      <div className="mt-4 flex gap-2">
        <Btn onClick={submit}>
          <Plus size={14} /> Add
        </Btn>
        <Btn variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
      </div>
    </QuickAddModal>
  )
}

export function QuickAddColourModal({ yarnLabel, onClose, onCreate }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const submit = async () => {
    if (!name.trim()) return setError('Colour name is required.')
    const err = await onCreate(name.trim())
    if (err) setError(err)
  }
  return (
    <QuickAddModal title={`Add colour — ${yarnLabel}`} onClose={onClose}>
      <div>
        <Label>Colour name</Label>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError('')
          }}
          placeholder="e.g. Maroon"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
      </div>
      {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
      <div className="mt-4 flex gap-2">
        <Btn onClick={submit}>
          <Plus size={14} /> Add
        </Btn>
        <Btn variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
      </div>
    </QuickAddModal>
  )
}

export function QuickAddWeaverModal({ onClose, onCreate }) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const submit = async () => {
    if (!name.trim()) return setError('Weaver name is required.')
    const err = await onCreate(name.trim(), address.trim(), whatsapp.trim(), email.trim())
    if (err) setError(err)
  }
  return (
    <QuickAddModal title="Add weaver" onClose={onClose}>
      <div className="grid gap-3">
        <div>
          <Label>Weaver name</Label>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError('')
            }}
            placeholder="e.g. Murugan Weaves"
          />
        </div>
        <div>
          <Label>Address (optional)</Label>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>WhatsApp (optional)</Label>
            <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </div>
          <div>
            <Label>Email (optional)</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
      </div>
      {error && <div className="text-xs mt-2 text-[#0D9488]">{error}</div>}
      <div className="mt-4 flex gap-2">
        <Btn onClick={submit}>
          <Plus size={14} /> Add
        </Btn>
        <Btn variant="ghost" onClick={onClose}>
          Cancel
        </Btn>
      </div>
    </QuickAddModal>
  )
}
