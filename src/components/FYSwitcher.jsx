import { useState } from 'react'
import { Calendar, ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { useFY } from '../context/FYContext'

export default function FYSwitcher({ canManage }) {
  const [open, setOpen] = useState(false)
  const { currentFY, financialYears, isClosed, switchTo, closeFY, reopenFY } = useFY()

  if (!currentFY) return null

  return (
    <div className="px-3 pt-2 pb-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2 py-2 rounded text-xs font-medium text-stone-300 hover:bg-white/5 hover:text-white"
      >
        <span className="flex items-center gap-1.5">
          <Calendar size={13} /> FY {currentFY}
          {isClosed && <Lock size={11} className="text-stone-500" />}
        </span>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {open && (
        <div className="mt-1 mb-1 space-y-0.5">
          {financialYears.map((fy) => (
            <div key={fy.label} className="flex items-center justify-between pl-6 pr-2 py-1 rounded text-xs">
              <button
                onClick={() => switchTo(fy.label)}
                className={fy.label === currentFY ? 'text-white font-semibold' : 'text-stone-400 hover:text-white'}
              >
                {fy.label}
                {fy.is_closed && <span className="ml-1 text-stone-500">(Closed)</span>}
              </button>
              {canManage &&
                (fy.is_closed ? (
                  <button onClick={() => reopenFY(fy.label)} className="text-stone-500 hover:text-[#0D9488]">
                    Reopen
                  </button>
                ) : (
                  <button onClick={() => closeFY(fy.label)} className="text-stone-500 hover:text-[#0D9488]">
                    Close
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
