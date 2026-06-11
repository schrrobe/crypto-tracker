import Papa from 'papaparse'
import { AppError } from '../lib/errors'

export const MAX_ROWS = 5000

export interface ParsedCsv {
  headers: string[]
  rows: Array<Record<string, string>>
}

// Parst CSV-Inhalt mit Header-Zeile. Trennzeichen (Komma/Semikolon/Tab) erkennt
// papaparse automatisch — deutsche Exporte nutzen häufig Semikolon.
export function parseCsv(content: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  })

  const headers = (result.meta.fields ?? []).filter((h) => h.length > 0)
  if (headers.length < 2) {
    throw AppError.badRequest(
      'CSV_PARSE_ERROR',
      'CSV konnte nicht gelesen werden — mindestens zwei Spalten mit Header-Zeile erwartet',
    )
  }
  if (result.data.length === 0) {
    throw AppError.badRequest('CSV_NO_ROWS', 'CSV enthält keine Datenzeilen')
  }
  if (result.data.length > MAX_ROWS) {
    throw AppError.badRequest('CSV_TOO_LARGE', `CSV hat mehr als ${MAX_ROWS} Zeilen`)
  }

  return { headers, rows: result.data }
}

// Mapping-Vorschlag anhand üblicher Spaltennamen (de/en)
const SYMBOL_HINTS = ['symbol', 'coin', 'asset', 'ticker', 'currency', 'währung', 'kryptowährung']
const QUANTITY_HINTS = ['quantity', 'amount', 'menge', 'anzahl', 'balance', 'qty', 'bestand']

function suggest(headers: string[], hints: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase())
  for (const hint of hints) {
    const index = lower.findIndex((h) => h === hint || h.includes(hint))
    if (index >= 0) return headers[index] ?? null
  }
  return null
}

export function suggestBalanceMapping(headers: string[]): { symbol: string | null; quantity: string | null } {
  return {
    symbol: suggest(headers, SYMBOL_HINTS),
    quantity: suggest(headers, QUANTITY_HINTS),
  }
}
