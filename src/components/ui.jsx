import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Plus } from 'lucide-react'

/* ---------- UI atoms — ported 1:1 from the DF-Trac prototype ---------- */

export const Card = ({ children, className = '' }) => (
  <div className={`bg-white border border-stone-200 rounded-md shadow-sm ${className}`}>{children}</div>
)

export const Label = ({ children }) => (
  <label className="block text-[11px] font-semibold tracking-wide uppercase text-stone-500 mb-1">{children}</label>
)

export const Input = (props) => (
  <input
    {...props}
    className={`w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] placeholder:text-stone-400 ${props.className || ''}`}
  />
)

export const Select = (props) => (
  <select
    {...props}
    className={`w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] disabled:opacity-50 disabled:cursor-not-allowed ${props.className || ''}`}
  />
)

/* Type-to-search replacement for <Select>. options: [{ value, label }];
   onChange receives the chosen value ('' never — pick is required to change).
   The list is portalled to <body> with fixed positioning so it isn't clipped
   by overflow-x-auto table wrappers. */
export function SearchSelect({ value, onChange, options, placeholder = 'Search…', disabled = false, className = '' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const selected = options.find((o) => o.value === value)
  const q = query.trim().toLowerCase()
  const matches = q
    ? options
        .filter((o) => o.label.toLowerCase().includes(q))
        .sort((a, b) => a.label.toLowerCase().startsWith(q) === b.label.toLowerCase().startsWith(q) ? 0 : a.label.toLowerCase().startsWith(q) ? -1 : 1)
    : options

  useLayoutEffect(() => {
    if (!open) return
    const place = () => setRect(inputRef.current?.getBoundingClientRect() || null)
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const openList = () => {
    if (disabled) return
    setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const choose = (o) => {
    if (o.value !== value) onChange(o.value)
    setOpen(false)
    setQuery('')
  }
  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault()
      return openList()
    }
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (matches[active]) choose(matches[active]) }
    else if (e.key === 'Escape') { setOpen(false); setQuery('') }
    else if (e.key === 'Tab') { if (q && matches[active]) choose(matches[active]); else setOpen(false) }
  }

  const spaceBelow = rect ? window.innerHeight - rect.bottom : 0
  const dropUp = rect && spaceBelow < 220 && rect.top > spaceBelow

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : selected?.label || ''}
        onFocus={openList}
        onClick={() => !open && openList()}
        onBlur={() => { setOpen(false); setQuery('') }}
        onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true) }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        className={`w-full rounded border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-[#0D9488]/30 focus:border-[#0D9488] placeholder:text-stone-400 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      />
      {open && rect &&
        createPortal(
          <ul
            ref={listRef}
            onMouseDown={(e) => e.preventDefault()}
            style={{
              position: 'fixed',
              left: rect.left,
              width: Math.max(rect.width, 180),
              ...(dropUp ? { bottom: window.innerHeight - rect.top + 2 } : { top: rect.bottom + 2 }),
              zIndex: 1000,
            }}
            className="max-h-56 overflow-y-auto rounded border border-stone-200 bg-white shadow-lg py-1 text-sm"
          >
            {matches.length === 0 ? (
              <li className="px-3 py-1.5 text-stone-400">No matches</li>
            ) : (
              matches.map((o, i) => (
                <li
                  key={o.value}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                  style={i === active ? { backgroundColor: '#F0FDFA', color: '#0F766E' } : {}}
                  className={`px-3 py-1.5 cursor-pointer ${o.value === value ? 'font-semibold' : ''}`}
                >
                  {o.label}
                </li>
              ))
            )}
          </ul>,
          document.body,
        )}
    </>
  )
}

export const Btn = ({ variant = 'primary', className = '', style = {}, ...props }) => {
  const styles = {
    primary: 'text-white transition-colors',
    ghost: 'bg-transparent text-stone-700 hover:bg-stone-100 border border-stone-300',
    danger: 'bg-transparent transition-colors',
  }
  const inlineStyle = { primary: { backgroundColor: '#0D9488' }, danger: { color: '#0D9488' } }[variant] || {}
  const [hover, setHover] = useState(false)
  const hoverStyle =
    variant === 'primary' && hover
      ? { backgroundColor: '#0F766E' }
      : variant === 'danger' && hover
        ? { backgroundColor: '#F0FDFA' }
        : {}
  return (
    <button
      {...props}
      onMouseEnter={(e) => {
        setHover(true)
        props.onMouseEnter?.(e)
      }}
      onMouseLeave={(e) => {
        setHover(false)
        props.onMouseLeave?.(e)
      }}
      style={{ ...inlineStyle, ...hoverStyle, ...style }}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    />
  )
}

export const Badge = ({ children, tone = 'neutral' }) => {
  const tones = {
    neutral: 'bg-stone-100 text-stone-600',
    good: 'bg-emerald-50 text-emerald-700',
    bad: '',
    warn: 'bg-amber-50 text-amber-700',
  }
  const inlineStyle = tone === 'bad' ? { backgroundColor: '#F0FDFA', color: '#0F766E' } : {}
  return (
    <span style={inlineStyle} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  )
}

export const Empty = ({ icon: Icon, title, hint }) => (
  <div className="flex flex-col items-center justify-center py-14 text-center px-6">
    <div className="w-11 h-11 rounded-full bg-stone-100 flex items-center justify-center mb-3">
      <Icon size={20} className="text-stone-400" />
    </div>
    <p className="text-sm font-semibold text-stone-800">{title}</p>
    {hint && <p className="text-xs text-stone-500 mt-1 max-w-xs">{hint}</p>}
  </div>
)

export const Header = ({ title, subtitle }) => (
  <div className="mb-6">
    <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
    {subtitle && <p className="text-sm text-stone-500 mt-1 max-w-2xl">{subtitle}</p>}
  </div>
)

export const SuffixedInput = ({ suffix, ...props }) => (
  <div className="relative">
    <Input {...props} className={`pr-7 ${props.className || ''}`} />
    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-400 pointer-events-none">{suffix}</span>
  </div>
)

export const IconBtn = ({ title, onClick, children, danger, disabled }) => (
  <button
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={`p-1.5 rounded-md transition-colors hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent ${danger ? 'text-[#0D9488]' : 'text-stone-400 hover:text-stone-600'}`}
  >
    {children}
  </button>
)

export const AddBtn = ({ title, onClick, disabled }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    disabled={disabled}
    className="shrink-0 w-9 rounded border border-stone-300 text-stone-500 flex items-center justify-center hover:text-[#0D9488] hover:border-[#0D9488] disabled:opacity-40 disabled:cursor-not-allowed"
  >
    <Plus size={14} />
  </button>
)

export function ConfirmBar({ text, onConfirm, onCancel }) {
  return (
    <div style={{ backgroundColor: '#F0FDFA' }} className="flex items-center gap-2 rounded px-3 py-2 text-xs text-[#0F766E]">
      <AlertTriangle size={14} />
      <span className="flex-1">{text}</span>
      <button onClick={onConfirm} className="font-semibold underline">
        Delete
      </button>
      <button onClick={onCancel} className="font-semibold">
        Cancel
      </button>
    </div>
  )
}

export function StatusBadge({ status }) {
  const styles = {
    pending: { backgroundColor: '#FFFBEB', color: '#B45309' },
    closed: { backgroundColor: '#F0FDFA', color: '#0F766E' },
    'short-closed': { backgroundColor: '#F5F5F4', color: '#57534E' },
  }
  const labels = { pending: 'Pending', closed: 'Closed', 'short-closed': 'Short-Closed' }
  return (
    <span style={styles[status]} className="px-2 py-0.5 rounded-full text-[11px] font-semibold">
      {labels[status]}
    </span>
  )
}
