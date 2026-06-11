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
