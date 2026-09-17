import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Thrown at import time so a missing .env.local fails loudly instead of
  // surfacing as a confusing network error the first time a query runs.
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local and fill in your Supabase project values.'
  )
}

export const supabase = createClient(url, anonKey)
