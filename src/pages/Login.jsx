import { useState } from 'react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) setError(error.message)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-stone-100">
      <div className="w-full max-w-sm rounded-2xl p-8 shadow-xl" style={{ backgroundColor: '#1C2620' }}>
        <div className="flex justify-center mb-1">
          <Logo size={64} dark />
        </div>
        <div className="text-center text-sm font-medium mb-7" style={{ color: '#5EEAD4' }}>
          PO &amp; Yarn Ledger
        </div>

        <form onSubmit={submit}>
          <label className="block text-[11px] font-semibold tracking-widest uppercase text-stone-400 mb-2">Email</label>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md bg-white text-stone-800 px-3.5 py-2.5 text-sm outline-none mb-4"
          />

          <label className="block text-[11px] font-semibold tracking-widest uppercase text-stone-400 mb-2">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md bg-white text-stone-800 px-3.5 py-2.5 text-sm outline-none mb-2"
          />

          {error && (
            <div className="text-xs mb-4" style={{ color: '#FCA5A5' }}>
              {error}
            </div>
          )}
          {!error && <div className="mb-4" />}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 rounded-md text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#F5F0E8' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#0D9488')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)')}
          >
            {busy ? 'Signing in…' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  )
}
