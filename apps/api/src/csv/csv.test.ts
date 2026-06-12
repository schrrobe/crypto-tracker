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

import { applyTransactionMapping, normalizeTxType, parseTimestamp } from './csv.mapper'

describe('normalizeTxType', () => {
  it('mappt deutsche und englische Typen', () => {
    expect(normalizeTxType('Kauf')).toBe('BUY')
    expect(normalizeTxType('buy')).toBe('BUY')
    expect(normalizeTxType('VERKAUF')).toBe('SELL')
    expect(normalizeTxType('Einzahlung')).toBe('DEPOSIT')
    expect(normalizeTxType('withdrawal')).toBe('WITHDRAWAL')
    expect(normalizeTxType('Staking')).toBe('STAKING_REWARD')
    expect(normalizeTxType('Reward')).toBe('STAKING_REWARD')
    expect(normalizeTxType('staking reward')).toBe('STAKING_REWARD')
    expect(normalizeTxType('Belohnung')).toBe('STAKING_REWARD')
    expect(normalizeTxType('quatsch')).toBeNull()
  })
})

describe('parseTimestamp', () => {
  it('parst ISO und deutsche Formate', () => {
    expect(parseTimestamp('2024-01-15')?.getFullYear()).toBe(2024)
    expect(parseTimestamp('2024-01-15T10:30:00Z')?.getUTCHours()).toBe(10)
    expect(parseTimestamp('15.01.2024')?.getMonth()).toBe(0)
    expect(parseTimestamp('15.01.2024 10:30')?.getMinutes()).toBe(30)
    expect(parseTimestamp('kein datum')).toBeNull()
    expect(parseTimestamp('')).toBeNull()
  })
})

describe('applyTransactionMapping', () => {
  const mapping = { symbol: 'Coin', quantity: 'Menge', type: 'Typ', timestamp: 'Datum' }

  it('validiert Typ und Datum, sammelt Fehlerzeilen', () => {
    const rows = [
      { Coin: 'BTC', Menge: '1', Typ: 'Kauf', Datum: '2024-01-01' }, // ok
      { Coin: 'BTC', Menge: '0,4', Typ: 'Verkauf', Datum: '01.02.2024' }, // ok
      { Coin: 'BTC', Menge: '1', Typ: 'hodl', Datum: '2024-01-01' }, // Zeile 4: Typ
      { Coin: 'SOL', Menge: '10', Typ: 'Kauf', Datum: 'gestern' }, // Zeile 5: Datum
    ]
    const { valid, errors } = applyTransactionMapping(rows, mapping)
    expect(valid).toHaveLength(2)
    expect(valid[0]).toMatchObject({ symbol: 'BTC', quantity: '1', type: 'BUY' })
    expect(valid[1]).toMatchObject({ symbol: 'BTC', quantity: '0.4', type: 'SELL' })
    expect(errors.map((e) => e.line)).toEqual([4, 5])
  })

  it('übernimmt optionale Preis-/Gebühren-/Währungs-Spalten', () => {
    const rows = [
      { Coin: 'BTC', Menge: '1', Typ: 'Kauf', Datum: '2024-01-01', Kurs: '42.000,50', Gebühr: '1,5', Fiat: 'eur' },
    ]
    const { valid } = applyTransactionMapping(rows, { ...mapping, price: 'Kurs', fee: 'Gebühr', currency: 'Fiat' })
    expect(valid[0]).toMatchObject({ price: '42000.50', fee: '1.5', currency: 'EUR' })
  })

  it('leere optionale Felder bleiben undefined statt Fehler zu erzeugen', () => {
    const rows = [{ Coin: 'SOL', Menge: '10', Typ: 'Einzahlung', Datum: '2024-03-01', Kurs: '', Gebühr: '' }]
    const { valid, errors } = applyTransactionMapping(rows, { ...mapping, price: 'Kurs', fee: 'Gebühr' })
    expect(errors).toHaveLength(0)
    expect(valid[0]?.price).toBeUndefined()
    expect(valid[0]?.fee).toBeUndefined()
  })
})

import { detectPreset, suggestMappingWithPreset } from './csv.parser'

describe('CSV-Presets (Kraken/Bitpanda)', () => {
  const KRAKEN_HEADERS = ['txid', 'refid', 'time', 'type', 'subtype', 'aclass', 'asset', 'amount', 'fee', 'balance']
  const BITPANDA_HEADERS = [
    'Transaction ID', 'Timestamp', 'Transaction Type', 'In/Out', 'Amount Fiat', 'Fiat',
    'Amount Asset', 'Asset', 'Asset market price', 'Asset market price currency',
    'Asset class', 'Product ID', 'Fee', 'Fee asset',
  ]

  it('erkennt Kraken-Ledger-Export und belegt das Mapping', () => {
    const detected = detectPreset(KRAKEN_HEADERS)
    expect(detected?.preset).toBe('KRAKEN')
    expect(detected?.mapping).toMatchObject({
      symbol: 'asset',
      quantity: 'amount',
      type: 'type',
      timestamp: 'time',
      fee: 'fee',
    })
  })

  it('erkennt Bitpanda-Export inkl. Kurs- und Währungsspalte', () => {
    const detected = detectPreset(BITPANDA_HEADERS)
    expect(detected?.preset).toBe('BITPANDA')
    expect(detected?.mapping).toMatchObject({
      symbol: 'Asset',
      quantity: 'Amount Asset',
      type: 'Transaction Type',
      timestamp: 'Timestamp',
      price: 'Asset market price',
      currency: 'Asset market price currency',
      fee: 'Fee',
    })
  })

  it('unbekannte Header fallen auf die Heuristik zurück (kein Preset)', () => {
    const { preset, mapping } = suggestMappingWithPreset(['Coin', 'Menge', 'Datum', 'Typ'], 'TRANSACTIONS')
    expect(preset).toBeNull()
    expect(mapping.symbol).toBe('Coin')
  })

  it('Presets greifen nur bei Transaktions-Importen', () => {
    const { preset } = suggestMappingWithPreset(KRAKEN_HEADERS, 'BALANCES')
    expect(preset).toBeNull()
  })

  it('Bitpanda-Typen incoming/outgoing werden gemappt', () => {
    expect(normalizeTxType('incoming')).toBe('DEPOSIT')
    expect(normalizeTxType('outgoing')).toBe('WITHDRAWAL')
  })
})
