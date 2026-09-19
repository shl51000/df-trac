import { readSheet } from 'read-excel-file/universal'
import writeExcelFile from 'write-excel-file/universal'
import { supabase } from './supabaseClient'
import { friendlyError } from './pgError'
import { withDenierSuffix } from './suffix'

export const TEMPLATE_HEADERS = ['Yarn Type', 'Colour Name', 'Stock in Hand', 'Denier']

const clean = (s) => String(s ?? '').trim().replace(/\s+/g, ' ')
export const normName = (s) => clean(s).toLowerCase()
const headerKey = (s) => normName(s).replace(/[^a-z0-9]/g, '').replace(/kgs?$/, '')

const HEADER_ALIASES = {
  yarn: ['yarntype', 'yarnquality', 'yarn', 'yarnname', 'quality'],
  colour: ['colourname', 'colour', 'colorname', 'color'],
  excess: ['stockinhand', 'stock', 'excessyarn', 'excess'],
  required: ['yarnrequired', 'required'],
  denier: ['denier'],
}

const findColumns = (row) => {
  const cols = {}
  row.forEach((cell, i) => {
    const k = headerKey(cell)
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (cols[field] === undefined && aliases.includes(k)) cols[field] = i
    }
  })
  return cols
}

// Blank → 0. Returns null for anything that isn't a plain non-negative number.
const parseQty = (v) => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : null
}

const DENIER_RE = /^\d+(\.\d+)?\s*d?$/i

export async function readOpeningBalanceFile(file) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Please choose an Excel .xlsx file (use "Save As → Excel Workbook" if yours is .xls or .csv).')
  return readSheet(file)
}

// yarnTypes: [{ id, name, colours: [{ id, colour_name }] }]
// Yarn types / colours not already in the library are returned in
// newYarns / newColours (nothing is written here); items refer to them by
// normalised name key until createMissingMasters() has assigned real ids.
export function parseOpeningBalanceSheet(data, yarnTypes) {
  let headerIdx = -1
  let cols = {}
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    const c = findColumns(data[i])
    if (c.yarn !== undefined && c.colour !== undefined && (c.excess !== undefined || c.required !== undefined)) {
      headerIdx = i
      cols = c
      break
    }
  }
  if (headerIdx < 0) {
    throw new Error(`Couldn't find the header row. The first sheet needs these columns: ${TEMPLATE_HEADERS.join(', ')}.`)
  }

  const existingYarn = new Map(yarnTypes.map((y) => [normName(y.name), y]))

  // First non-blank Denier seen for each yarn, so it doesn't matter which of
  // that yarn's rows carries it.
  const denierByYarn = new Map()
  if (cols.denier !== undefined) {
    for (let i = headerIdx + 1; i < data.length; i++) {
      const yk = normName(data[i][cols.yarn])
      const d = clean(data[i][cols.denier])
      if (yk && d && !denierByYarn.has(yk)) denierByYarn.set(yk, d)
    }
  }

  const newYarns = new Map() // yarnKey → { key, name, denier }
  const newColours = new Map() // `${yarnKey}|${colourKey}` → { yarnKey, yarnId, key, name }
  const merged = new Map()
  const skipped = []
  let duplicates = 0

  for (let i = headerIdx + 1; i < data.length; i++) {
    const r = data[i]
    const excess = cols.excess !== undefined ? parseQty(r[cols.excess]) : 0
    const required = cols.required !== undefined ? parseQty(r[cols.required]) : 0
    const excelRow = i + 1

    if (excess === null || required === null) {
      skipped.push({ row: excelRow, reason: 'quantity is not a valid number' })
      continue
    }
    if (excess > 0 && required > 0) {
      skipped.push({ row: excelRow, reason: 'has both Stock in Hand and Yarn Required (only one allowed per row)' })
      continue
    }
    if (excess === 0 && required === 0) continue

    const yarnName = clean(r[cols.yarn])
    const colourName = clean(r[cols.colour])
    if (!yarnName) {
      skipped.push({ row: excelRow, reason: 'Yarn Type is blank' })
      continue
    }
    if (!colourName) {
      skipped.push({ row: excelRow, reason: 'Colour Name is blank' })
      continue
    }
    const yarnKey = normName(yarnName)
    const colourKey = normName(colourName)

    const yarn = existingYarn.get(yarnKey)
    if (!yarn && !newYarns.has(yarnKey)) {
      const rawDenier = denierByYarn.get(yarnKey)
      if (!rawDenier) {
        skipped.push({ row: excelRow, reason: `"${yarnName}" is a new yarn type — add its Denier in the Denier column` })
        continue
      }
      if (!DENIER_RE.test(rawDenier)) {
        skipped.push({ row: excelRow, reason: `Denier "${rawDenier}" for "${yarnName}" isn't a number` })
        continue
      }
      newYarns.set(yarnKey, { key: yarnKey, name: yarnName, denier: withDenierSuffix(rawDenier) })
    }

    const colour = yarn?.colours.find((c) => normName(c.colour_name) === colourKey)
    if (!colour) {
      const ck = `${yarnKey}|${colourKey}`
      if (!newColours.has(ck)) newColours.set(ck, { yarnKey, yarnId: yarn?.id ?? null, key: colourKey, name: colourName })
    }

    const itemKey = `${yarnKey}|${colourKey}`
    const prev = merged.get(itemKey)
    if (prev) {
      if ((prev.excessKg > 0 && required > 0) || (prev.requiredKg > 0 && excess > 0)) {
        skipped.push({ row: excelRow, reason: `${yarnName} / ${colourName} appears again with the opposite type (stock vs required)` })
        continue
      }
      prev.excessKg += excess
      prev.requiredKg += required
      duplicates++
    } else {
      merged.set(itemKey, { yarnKey, colourKey, yarnId: yarn?.id ?? null, colourId: colour?.id ?? null, requiredKg: required, excessKg: excess })
    }
  }

  return { items: [...merged.values()], newYarns: [...newYarns.values()], newColours: [...newColours.values()], skipped, duplicates }
}

// Inserts the yarn types and colours the sheet introduced, then returns the
// items with every yarnTypeId/colourId filled in.
export async function createMissingMasters(parsed) {
  const yarnIdByKey = new Map()
  if (parsed.newYarns.length) {
    const { data, error } = await supabase
      .from('yarn_types')
      .insert(parsed.newYarns.map((y) => ({ name: y.name, denier: y.denier })))
      .select()
    if (error) throw new Error(friendlyError(error))
    data.forEach((y) => yarnIdByKey.set(normName(y.name), y.id))
  }

  const colourIdByKey = new Map()
  if (parsed.newColours.length) {
    const { data, error } = await supabase
      .from('yarn_colours')
      .insert(parsed.newColours.map((c) => ({ yarn_type_id: c.yarnId ?? yarnIdByKey.get(c.yarnKey), colour_name: c.name })))
      .select()
    if (error) throw new Error(friendlyError(error))
    data.forEach((c) => colourIdByKey.set(`${c.yarn_type_id}|${normName(c.colour_name)}`, c.id))
  }

  return parsed.items.map((it) => {
    const yarnTypeId = it.yarnId ?? yarnIdByKey.get(it.yarnKey)
    const colourId = it.colourId ?? colourIdByKey.get(`${yarnTypeId}|${it.colourKey}`)
    return { yarnTypeId, colourId, requiredKg: it.requiredKg, excessKg: it.excessKg }
  })
}

export async function downloadOpeningBalanceTemplate(yarnTypes) {
  const bold = (value) => ({ value, fontWeight: 'bold' })
  const rows = [TEMPLATE_HEADERS.map(bold)]
  ;[...yarnTypes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((y) =>
      [...y.colours]
        .sort((a, b) => a.colour_name.localeCompare(b.colour_name))
        .forEach((c) => rows.push([y.name, c.colour_name, null, y.denier]))
    )
  const blob = await writeExcelFile(rows, { columns: [{ width: 30 }, { width: 26 }, { width: 16 }, { width: 12 }], stickyRowsCount: 1 }).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'opening-balance-template.xlsx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
