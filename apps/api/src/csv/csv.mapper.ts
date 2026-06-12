export interface BalanceMapping {
  symbol: string
  quantity: string
}

export interface MappedBalanceRow {
  symbol: string
  quantity: string // normalisierter Dezimal-String mit Punkt
}

export interface RowError {
  line: number // 1-basiert inkl. Header (Datenzeilen starten bei 2) — wie im Editor
  raw: string
  error: string
}

// Normalisiert deutsche und englische Zahlformate auf einen Dezimal-String mit Punkt:
// "1.234,56" → "1234.56" · "1,5" → "1.5" · "1,234.56" → "1234.56" · "2" → "2"
export function normalizeNumber(value: string): string | null {
  const trimmed = value.trim().replace(/\s/g, '')
  if (!trimmed) return null

  const hasComma = trimmed.includes(',')
  const hasDot = trimmed.includes('.')
  let normalized = trimmed

  if (hasComma && hasDot) {
    // Das letzte Trennzeichen ist der Dezimaltrenner, das andere Tausendertrennzeichen
    normalized =
      trimmed.lastIndexOf(',') > trimmed.lastIndexOf('.')
        ? trimmed.replace(/\./g, '').replace(',', '.')
        : trimmed.replace(/,/g, '')
  } else if (hasComma) {
    // Mehrere Kommas ("1,234,567") = Tausendertrennzeichen, eines = Dezimalkomma
    normalized = (trimmed.match(/,/g) ?? []).length > 1 ? trimmed.replace(/,/g, '') : trimmed.replace(',', '.')
  }

  return /^\d+(\.\d+)?$/.test(normalized) ? normalized : null
}

export interface TransactionMapping {
  symbol: string
  quantity: string
  type: string
  timestamp: string
  price?: string
  fee?: string
  currency?: string
}

export interface MappedTransactionRow {
  symbol: string
  quantity: string
  type: 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER' | 'STAKING_REWARD' | 'OTHER'
  timestamp: Date
  price?: string
  fee?: string
  currency?: string
}

// Übliche Bezeichnungen aus Exchange-Exporten (de/en) → TxType
const TYPE_ALIASES: Record<string, MappedTransactionRow['type']> = {
  buy: 'BUY', kauf: 'BUY', purchase: 'BUY',
  sell: 'SELL', verkauf: 'SELL', sale: 'SELL',
  deposit: 'DEPOSIT', einzahlung: 'DEPOSIT', receive: 'DEPOSIT', erhalten: 'DEPOSIT',
  withdrawal: 'WITHDRAWAL', auszahlung: 'WITHDRAWAL', send: 'WITHDRAWAL', gesendet: 'WITHDRAWAL',
  transfer: 'TRANSFER', umbuchung: 'TRANSFER',
  staking: 'STAKING_REWARD', reward: 'STAKING_REWARD', belohnung: 'STAKING_REWARD',
  'staking reward': 'STAKING_REWARD', 'staking-reward': 'STAKING_REWARD',
  other: 'OTHER', sonstiges: 'OTHER',
}

export function normalizeTxType(value: string): MappedTransactionRow['type'] | null {
  return TYPE_ALIASES[value.trim().toLowerCase()] ?? null
}

// ISO 8601 / YYYY-MM-DD / DD.MM.YYYY [HH:mm[:ss]]
export function parseTimestamp(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(trimmed)) {
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const german = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (german) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = german
    const date = new Date(
      Number(year), Number(month) - 1, Number(day),
      Number(hour), Number(minute), Number(second),
    )
    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

export function applyTransactionMapping(
  rows: Array<Record<string, string>>,
  mapping: TransactionMapping,
): { valid: MappedTransactionRow[]; errors: RowError[] } {
  const valid: MappedTransactionRow[] = []
  const errors: RowError[] = []

  rows.forEach((row, index) => {
    const line = index + 2
    const raw = Object.values(row).join(', ')

    const symbol = (row[mapping.symbol] ?? '').trim().toUpperCase()
    if (!symbol || symbol.length > 20) {
      errors.push({ line, raw, error: `Spalte „${mapping.symbol}": kein gültiges Symbol` })
      return
    }

    const rawQuantity = row[mapping.quantity] ?? ''
    const quantity = normalizeNumber(rawQuantity)
    if (quantity === null || Number(quantity) <= 0) {
      errors.push({ line, raw, error: `Spalte „${mapping.quantity}": „${rawQuantity.trim()}" ist keine gültige Menge` })
      return
    }

    const rawType = row[mapping.type] ?? ''
    const type = normalizeTxType(rawType)
    if (!type) {
      errors.push({ line, raw, error: `Spalte „${mapping.type}": „${rawType.trim()}" ist kein bekannter Typ` })
      return
    }

    const rawTimestamp = row[mapping.timestamp] ?? ''
    const timestamp = parseTimestamp(rawTimestamp)
    if (!timestamp) {
      errors.push({ line, raw, error: `Spalte „${mapping.timestamp}": „${rawTimestamp.trim()}" ist kein gültiges Datum` })
      return
    }

    const price = mapping.price ? (normalizeNumber(row[mapping.price] ?? '') ?? undefined) : undefined
    const fee = mapping.fee ? (normalizeNumber(row[mapping.fee] ?? '') ?? undefined) : undefined
    const currency = mapping.currency ? (row[mapping.currency] ?? '').trim().toUpperCase() || undefined : undefined

    valid.push({ symbol, quantity, type, timestamp, price, fee, currency })
  })

  return { valid, errors }
}

export function applyBalanceMapping(
  rows: Array<Record<string, string>>,
  mapping: BalanceMapping,
): { valid: MappedBalanceRow[]; errors: RowError[] } {
  const valid: MappedBalanceRow[] = []
  const errors: RowError[] = []

  rows.forEach((row, index) => {
    const line = index + 2 // Zeile 1 = Header
    const raw = Object.values(row).join(', ')

    const symbol = (row[mapping.symbol] ?? '').trim().toUpperCase()
    if (!symbol || symbol.length > 20) {
      errors.push({ line, raw, error: `Spalte „${mapping.symbol}": kein gültiges Symbol` })
      return
    }

    const rawQuantity = row[mapping.quantity] ?? ''
    const quantity = normalizeNumber(rawQuantity)
    if (quantity === null) {
      errors.push({ line, raw, error: `Spalte „${mapping.quantity}": „${rawQuantity.trim()}" ist keine gültige Zahl` })
      return
    }
    if (Number(quantity) <= 0) {
      errors.push({ line, raw, error: `Spalte „${mapping.quantity}": Menge muss größer 0 sein` })
      return
    }

    valid.push({ symbol, quantity })
  })

  return { valid, errors }
}
