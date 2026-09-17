import { Loader2 } from 'lucide-react'

export default function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#1C2620' }}>
      <div className="flex items-center gap-2 text-stone-300">
        <Loader2 className="animate-spin" size={18} />
        <span className="text-sm">Loading…</span>
      </div>
    </div>
  )
}
