import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'reference', 'supabase']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Fires on the ordinary fetch-on-mount pattern (useEffect(() => { load() }, []))
      // used throughout this app's data-fetching pages; not applicable without
      // the React Compiler.
      'react-hooks/set-state-in-effect': 'off',
      // Fires on reading ref.current inside a plain event handler (e.g. an
      // html2canvas capture triggered by a button click) — the standard,
      // safe way to use a ref; only unsafe when read during render itself.
      'react-hooks/refs': 'off',
    },
  },
  {
    // Context modules intentionally export both a Provider component and
    // its paired useX() hook from the same file — standard React context
    // pattern, not a fast-refresh problem worth splitting files over.
    files: ['src/context/**/*.jsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
