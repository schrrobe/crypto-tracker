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
const TYPE_HINTS = ['type', 'typ', 'side', 'art', 'transaction']
const TIMESTAMP_HINTS = ['date', 'datum', 'timestamp', 'time', 'zeit']
const PRICE_HINTS = ['price', 'preis', 'rate', 'kurs']
const FEE_HINTS = ['fee', 'gebühr']
const CURRENCY_HINTS = ['fiat', 'quote']

function suggest(headers: string[], hints: string[], taken: Set<string | null> = new Set()): string | null {
  const lower = headers.map((h) => h.toLowerCase())
  for (const hint of hints) {
    const index = lower.findIndex((h, i) => !taken.has(headers[i] ?? null) && (h === hint || h.includes(hint)))
    if (index >= 0) return headers[index] ?? null
  }
  return null
}

export interface MappingSuggestion {
  symbol: string | null
  quantity: string | null
  type: string | null
  timestamp: string | null
  price: string | null
  fee: string | null
  currency: string | null
}

export type CsvPreset = 'KRAKEN' | 'BITPANDA'

// Bekannte Export-Formate: eindeutige Header-Signatur → fertiges Mapping.
// Schlägt die Heuristik, weil z.B. Kraken "asset"/"amount" generisch benennt,
// aber die Signatur (txid+refid) das Format eindeutig macht.
const PRESETS: Array<{
  preset: CsvPreset
  // alle Signatur-Header müssen vorhanden sein (case-insensitive)
  signature: string[]
  columns: Partial<Record<keyof MappingSuggestion, string>>
}> = [
  {
    preset: 'KRAKEN',
    // Kraken ledgers.csv: txid,refid,time,type,subtype,aclass,asset,amount,fee,balance
    signature: ['txid', 'refid', 'time', 'type', 'asset', 'amount'],
    columns: { symbol: 'asset', quantity: 'amount', type: 'type', timestamp: 'time', fee: 'fee' },
  },
  {
    preset: 'BITPANDA',
    // Bitpanda-Export: Transaction ID,Timestamp,Transaction Type,…,Amount Asset,Asset,Asset market price,…
    signature: ['transaction id', 'timestamp', 'transaction type', 'amount asset', 'asset'],
    columns: {
      symbol: 'Asset',
      quantity: 'Amount Asset',
      type: 'Transaction Type',
      timestamp: 'Timestamp',
      price: 'Asset market price',
      fee: 'Fee',
      currency: 'Asset market price currency',
    },
  },
]

function findHeader(headers: string[], wanted: string): string | null {
  return headers.find((h) => h.toLowerCase() === wanted.toLowerCase()) ?? null
}

export function detectPreset(
  headers: string[],
): { preset: CsvPreset; mapping: MappingSuggestion } | null {
  const lower = new Set(headers.map((h) => h.toLowerCase()))
  for (const candidate of PRESETS) {
    if (!candidate.signature.every((s) => lower.has(s))) continue
    const mapping: MappingSuggestion = {
      symbol: null, quantity: null, type: null, timestamp: null, price: null, fee: null, currency: null,
    }
    for (const [field, column] of Object.entries(candidate.columns)) {
      mapping[field as keyof MappingSuggestion] = findHeader(headers, column)
    }
    return { preset: candidate.preset, mapping }
  }
  return null
}

export function suggestMappingWithPreset(
  headers: string[],
  kind: 'BALANCES' | 'TRANSACTIONS',
): { mapping: MappingSuggestion; preset: CsvPreset | null } {
  if (kind === 'TRANSACTIONS') {
    const detected = detectPreset(headers)
    if (detected) return { mapping: detected.mapping, preset: detected.preset }
  }
  return { mapping: suggestMapping(headers, kind), preset: null }
}

export function suggestMapping(headers: string[], kind: 'BALANCES' | 'TRANSACTIONS'): MappingSuggestion {
  const taken = new Set<string | null>()
  const pick = (hints: string[]) => {
    const result = suggest(headers, hints, taken)
    taken.add(result)
    return result
  }

  if (kind === 'BALANCES') {
    return {
      symbol: pick(SYMBOL_HINTS),
      quantity: pick(QUANTITY_HINTS),
      type: null,
      timestamp: null,
      price: null,
      fee: null,
      currency: null,
    }
  }
  // Reihenfolge wichtig: type/timestamp zuerst, damit "transaction type" nicht als Symbol matcht
  const type = pick(TYPE_HINTS)
  const timestamp = pick(TIMESTAMP_HINTS)
  return {
    type,
    timestamp,
    symbol: pick(SYMBOL_HINTS),
    quantity: pick(QUANTITY_HINTS),
    price: pick(PRICE_HINTS),
    fee: pick(FEE_HINTS),
    currency: pick(CURRENCY_HINTS),
  }
}

// Rückwärtskompatibel für bestehende Aufrufer/Tests
export function suggestBalanceMapping(headers: string[]): { symbol: string | null; quantity: string | null } {
  const { symbol, quantity } = suggestMapping(headers, 'BALANCES')
  return { symbol, quantity }
}
