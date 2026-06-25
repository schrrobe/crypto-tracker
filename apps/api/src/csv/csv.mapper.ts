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
  // Bitpanda-Vokabular
  incoming: 'DEPOSIT', outgoing: 'WITHDRAWAL',
  staking: 'STAKING_REWARD', reward: 'STAKING_REWARD', belohnung: 'STAKING_REWARD', dividend: 'STAKING_REWARD',
  'staking reward': 'STAKING_REWARD', 'staking-reward': 'STAKING_REWARD',
  other: 'OTHER', sonstiges: 'OTHER',
}

export function normalizeTxType(value: string): MappedTransactionRow['type'] | null {
  return TYPE_ALIASES[value.trim().toLowerCase()] ?? null
}

// Vorzeichenbehaftete Beträge (z.B. Kraken-Ledger: Abflüsse sind negativ):
// "-12,5" → { value: "12.5", negative: true } · "0.5" → { value: "0.5", negative: false }
export function normalizeSignedNumber(value: string): { value: string; negative: boolean } | null {
  const trimmed = value.trim().replace(/\s/g, '')
  if (!trimmed) return null
  const negative = trimmed.startsWith('-')
  const unsigned = normalizeNumber(trimmed.replace(/^[+-]/, ''))
  if (unsigned === null) return null
  return { value: unsigned, negative }
}

// Kraken-Ledger-Typen sind teils richtungsneutral ("trade"/"spend"/"receive") — dort
// bestimmt das Vorzeichen des Betrags die Richtung. Eindeutige Typen
// (deposit/withdrawal/staking/transfer) bleiben erhalten.
export function signedTxType(rawType: string, negative: boolean): MappedTransactionRow['type'] {
  const explicit = TYPE_ALIASES[rawType.trim().toLowerCase()]
  if (
    explicit === 'DEPOSIT' ||
    explicit === 'WITHDRAWAL' ||
    explicit === 'STAKING_REWARD' ||
    explicit === 'TRANSFER'
  ) {
    return explicit
  }
  return negative ? 'SELL' : 'BUY'
}

// CSV-Zeitstempel ohne explizite Zeitzone werden als lokale Zeit der Zielgruppe
// (Europe/Berlin, CET/CEST) interpretiert. Sonst hinge das gespeicherte UTC-Instant
// von der Server-Zeitzone ab (Container meist UTC) und der Steuerreport, der nach
// Zivildatum bucketet, würde an Tagesgrenzen ins falsche Datum/Jahr kippen.
// Eingaben mit Zone (Z oder ±hh:mm) behalten ihre Zone.
const CSV_TIMEZONE = 'Europe/Berlin'

// Wandelt eine Wanduhrzeit in CSV_TIMEZONE in den korrekten UTC-Instant um —
// DST-korrekt, weil der Offset für genau dieses Datum aus Intl bestimmt wird.
function wallClockToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CSV_TIMEZONE,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcGuess))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  const zoneHour = get('hour') === 24 ? 0 : get('hour') // Intl kann 24 statt 0 liefern
  const zoneAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), zoneHour, get('minute'), get('second'))
  return new Date(utcGuess - (zoneAsUtc - utcGuess))
}

// ISO 8601 / YYYY-MM-DD / DD.MM.YYYY [HH:mm[:ss]]
export function parseTimestamp(value: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  const iso = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/,
  )
  if (iso) {
    const [, year, month, day, hour = '0', minute = '0', second = '0', zone] = iso
    if (zone) {
      const date = new Date(trimmed) // explizite Zone → eindeutig
      return Number.isNaN(date.getTime()) ? null : date
    }
    return wallClockToUtc(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second))
  }

  const german = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/)
  if (german) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = german
    return wallClockToUtc(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second))
  }

  return null
}

// Preset-spezifisches Verhalten (z.B. Kraken-Ledger). Generische CSVs lassen die
// Optionen weg und behalten das frühere Verhalten (unsignierte Menge, Typ aus Spalte).
export interface TransactionMappingOptions {
  // Menge darf negativ sein; gespeichert wird |Menge|, die Richtung folgt dem Vorzeichen.
  signedQuantity?: boolean
  // Rohes Symbol normalisieren (z.B. Kraken XXBT→BTC). null → Zeile überspringen
  // (Fiat-/Fee-Leg eines Trades) — das ist kein Fehler.
  normalizeSymbol?: (raw: string) => string | null
}

export function applyTransactionMapping(
  rows: Array<Record<string, string>>,
  mapping: TransactionMapping,
  options: TransactionMappingOptions = {},
): { valid: MappedTransactionRow[]; errors: RowError[]; skipped: number } {
  const valid: MappedTransactionRow[] = []
  const errors: RowError[] = []
  let skipped = 0

  rows.forEach((row, index) => {
    const line = index + 2
    const raw = Object.values(row).join(', ')

    const rawSymbol = row[mapping.symbol] ?? ''
    let symbol: string
    if (options.normalizeSymbol) {
      const normalized = options.normalizeSymbol(rawSymbol)
      if (normalized === null) {
        skipped += 1 // z.B. Fiat-/Fee-Leg eines Kraken-Trades — bewusst übersprungen
        return
      }
      symbol = normalized.toUpperCase()
    } else {
      symbol = rawSymbol.trim().toUpperCase()
    }
    if (!symbol || symbol.length > 20) {
      errors.push({ line, raw, error: `Spalte „${mapping.symbol}": kein gültiges Symbol` })
      return
    }

    const rawQuantity = row[mapping.quantity] ?? ''
    let quantity: string
    let negative = false
    if (options.signedQuantity) {
      const signed = normalizeSignedNumber(rawQuantity)
      if (signed === null) {
        errors.push({ line, raw, error: `Spalte „${mapping.quantity}": „${rawQuantity.trim()}" ist keine gültige Menge` })
        return
      }
      if (Number(signed.value) === 0) {
        skipped += 1 // z.B. reine Gebührenzeile (amount 0) — keine Bestandsänderung
        return
      }
      quantity = signed.value
      negative = signed.negative
    } else {
      const q = normalizeNumber(rawQuantity)
      if (q === null || Number(q) <= 0) {
        errors.push({ line, raw, error: `Spalte „${mapping.quantity}": „${rawQuantity.trim()}" ist keine gültige Menge` })
        return
      }
      quantity = q
    }

    const rawType = row[mapping.type] ?? ''
    const type = options.signedQuantity ? signedTxType(rawType, negative) : normalizeTxType(rawType)
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

  return { valid, errors, skipped }
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
