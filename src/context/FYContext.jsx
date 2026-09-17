import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const FYContext = createContext(null)

export function FYProvider({ children }) {
  const [currentFY, setCurrentFY] = useState(null)
  const [financialYears, setFinancialYears] = useState([]) // [{ label, is_closed }]
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [{ data: settings }, { data: fys }] = await Promise.all([
      supabase.from('app_settings').select('current_fy').eq('id', true).single(),
      supabase.from('financial_years').select('label, is_closed').order('label', { ascending: false }),
    ])
    setCurrentFY(settings?.current_fy ?? null)
    setFinancialYears(fys ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const switchTo = async (label) => {
    const { error } = await supabase.from('app_settings').update({ current_fy: label }).eq('id', true)
    if (!error) setCurrentFY(label)
    return error
  }

  const setClosed = async (label, isClosed) => {
    const { error } = await supabase.from('financial_years').update({ is_closed: isClosed }).eq('label', label)
    if (!error) await reload()
    return error
  }

  const isClosed = financialYears.find((f) => f.label === currentFY)?.is_closed ?? false

  return (
    <FYContext.Provider
      value={{ currentFY, financialYears, isClosed, loading, switchTo, closeFY: (l) => setClosed(l, true), reopenFY: (l) => setClosed(l, false), reload }}
    >
      {children}
    </FYContext.Provider>
  )
}

export function useFY() {
  const ctx = useContext(FYContext)
  if (!ctx) throw new Error('useFY must be used within a FYProvider')
  return ctx
}
