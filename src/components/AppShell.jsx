import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Menu, X, LogOut, FileText, Scale, PackageMinus, PackageCheck, Hourglass,
  Warehouse, Users, LayoutGrid, Boxes, Tag, Calculator, KeyRound, BookOpen, ClipboardList,
} from 'lucide-react'
import Logo from './Logo'
import FYSwitcher from './FYSwitcher'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { to: '/production-orders', label: 'Production Orders', icon: FileText, ready: true },
  { to: '/yarn-required', label: 'Yarn Required', icon: Scale, ready: true },
  { to: '/yarn-issued', label: 'Yarn Issue / RMDC', icon: PackageMinus, ready: true },
  { to: '/goods-receipt', label: 'Goods Receipt', icon: PackageCheck, ready: true },
  { to: '/pending-orders', label: 'Pending Orders', icon: Hourglass, ready: true },
  { to: '/stock', label: 'Stock-in-Hand', icon: Warehouse, ready: true },
  { to: '/weavers', label: 'Weavers', icon: Users, ready: true },
  { to: '/design-library', label: 'Design Library', icon: LayoutGrid, ready: true },
  { to: '/yarn-types', label: 'Yarn Library', icon: Boxes, ready: true },
  { to: '/fabric-types', label: 'Fabric Types', icon: Tag, ready: true },
  { to: '/consumption-norms', label: 'Consumption Norms', icon: Calculator, ready: true, adminOnly: true },
  { to: '/reports', label: 'Reports', icon: ClipboardList, ready: true },
  { to: '/opening-balance', label: 'Opening Balance', icon: BookOpen, ready: true },
  { to: '/users', label: 'Users', icon: KeyRound, ready: true, adminOnly: true },
]

function NavButton({ n, onNavigate }) {
  const Icon = n.icon
  if (!n.ready) {
    return (
      <button
        disabled
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded text-sm font-medium text-stone-400 opacity-40 cursor-not-allowed"
      >
        <Icon size={16} />
        {n.label}
        <span className="ml-auto text-[10px] font-normal">soon</span>
      </button>
    )
  }
  return (
    <NavLink
      to={n.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `w-full flex items-center gap-2.5 px-3 py-2.5 rounded text-sm font-medium transition-colors ${
          isActive ? 'text-white' : 'text-stone-400 hover:bg-white/5 hover:text-white'
        }`
      }
      style={({ isActive }) => (isActive ? { backgroundColor: '#0D9488' } : {})}
    >
      <Icon size={16} />
      {n.label}
    </NavLink>
  )
}

export default function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const { profile, isAdmin, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800 flex flex-col md:flex-row">
      <div style={{ backgroundColor: '#1C2620' }} className="md:hidden flex items-center justify-between px-4 py-3 text-white sticky top-0 z-30">
        <Logo size={30} dark />
        <button onClick={() => setNavOpen((v) => !v)}>{navOpen ? <X size={20} /> : <Menu size={20} />}</button>
      </div>

      <div
        style={{ backgroundColor: '#1C2620' }}
        className={`${navOpen ? 'block' : 'hidden'} md:block md:w-56 shrink-0 text-white relative flex flex-col`}
      >
        <div className="hidden md:block px-5 pt-6 pb-5">
          <Logo size={40} dark />
        </div>
        <nav className="px-2 pb-3 pt-2 md:pt-0 space-y-0.5">
          {NAV.filter((n) => isAdmin || !n.adminOnly).map((n) => (
            <NavButton key={n.to} n={n} onNavigate={() => setNavOpen(false)} />
          ))}
        </nav>
        <FYSwitcher canManage={isAdmin} />
        <div className="mt-auto px-3 pb-5 pt-3 border-t border-white/10">
          <div className="px-2 text-[11px] text-stone-400 mb-1.5">
            {profile?.name} · <span className="text-white font-medium">{isAdmin ? 'Admin' : 'User'}</span>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-1.5 text-left px-2 py-1.5 rounded text-xs text-stone-400 hover:text-white hover:bg-white/5"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      <div className="flex-1 min-w-0 flex">
        <div className="w-px bg-stone-200 hidden md:block" />
        <div className="flex-1 min-w-0 px-4 md:px-8 py-6 md:py-8 max-w-6xl">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
