import { describe, expect, it } from 'vitest'
import { parseCsv, suggestBalanceMapping } from './csv.parser'
import { applyBalanceMapping, normalizeNumber } from './csv.mapper'

describe('parseCsv', () => {
  it('parst Komma-CSV mit Header', () => {
    const { headers, rows } = parseCsv('Coin,Amount\nBTC,0.5\nETH,2')
    expect(headers).toEqual(['Coin', 'Amount'])
    expect(rows).toEqual([
      { Coin: 'BTC', Amount: '0.5' },
      { Coin: 'ETH', Amount: '2' },
    ])
  })

  it('parst deutsche Semikolon-CSV', () => {
    const { headers, rows } = parseCsv('Währung;Menge\nBTC;0,5\nSOL;10')
    expect(headers).toEqual(['Währung', 'Menge'])
    expect(rows[0]).toEqual({ 'Währung': 'BTC', Menge: '0,5' })
  })

  it('wirft bei leerer Datei und fehlendem Header', () => {
    expect(() => parseCsv('')).toThrow()
    expect(() => parseCsv('nur-eine-spalte\nBTC')).toThrow()
    expect(() => parseCsv('Coin,Amount\n')).toThrow()
  })
})

describe('suggestBalanceMapping', () => {
  it('erkennt englische und deutsche Spaltennamen', () => {
    expect(suggestBalanceMapping(['Coin', 'Amount'])).toEqual({ symbol: 'Coin', quantity: 'Amount' })
    expect(suggestBalanceMapping(['Währung', 'Menge'])).toEqual({ symbol: 'Währung', quantity: 'Menge' })
    expect(suggestBalanceMapping(['Asset Symbol', 'Total Balance'])).toEqual({
      symbol: 'Asset Symbol',
      quantity: 'Total Balance',
    })
  })

  it('liefert null bei unbekannten Spalten', () => {
    expect(suggestBalanceMapping(['A', 'B'])).toEqual({ symbol: null, quantity: null })
  })
})

describe('normalizeNumber', () => {
  it('verarbeitet deutsche und englische Formate', () => {
    expect(normalizeNumber('0.5')).toBe('0.5')
    expect(normalizeNumber('0,5')).toBe('0.5')
    expect(normalizeNumber('1.234,56')).toBe('1234.56')
    expect(normalizeNumber('1,234.56')).toBe('1234.56')
    expect(normalizeNumber('1,234,567')).toBe('1234567')
    expect(normalizeNumber(' 2 ')).toBe('2')
  })

  it('lehnt Ungültiges ab', () => {
    expect(normalizeNumber('')).toBeNull()
    expect(normalizeNumber('abc')).toBeNull()
    expect(normalizeNumber('1.2.3,4,5')).toBeNull()
    expect(normalizeNumber('-1')).toBeNull()
  })
})

describe('applyBalanceMapping', () => {
  const mapping = { symbol: 'Coin', quantity: 'Amount' }

  it('trennt gültige Zeilen und Fehlerzeilen mit Zeilennummern', () => {
    const rows = [
      { Coin: 'BTC', Amount: '0,5' }, // Zeile 2: ok
      { Coin: '', Amount: '1' }, // Zeile 3: Symbol fehlt
      { Coin: 'ETH', Amount: 'viel' }, // Zeile 4: keine Zahl
      { Coin: 'SOL', Amount: '0' }, // Zeile 5: nicht > 0
      { Coin: 'ada', Amount: '100' }, // Zeile 6: ok, uppercased
    ]
    const { valid, errors } = applyBalanceMapping(rows, mapping)

    expect(valid).toEqual([
      { symbol: 'BTC', quantity: '0.5' },
      { symbol: 'ADA', quantity: '100' },
    ])
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5])
    expect(errors[1]?.error).toContain('keine gültige Zahl')
  })
})
