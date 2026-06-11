import { beforeAll, describe, expect, it, vi } from 'vitest'

// Sprache vor dem i18n-Import festnageln (Modul liest localStorage beim Laden)
beforeAll(() => {
  localStorage.setItem('language', 'de')
})

// Intl nutzt geschützte Leerzeichen — für Assertions normalisieren
function plain(s: string): string {
  return s.replace(/\u00a0/g, ' ')
}

describe('format (Locale de)', () => {
  it('formatCurrency: deutsches Format, null → Strich', async () => {
    const { formatCurrency } = await import('./format')
    expect(plain(formatCurrency('25000.00', 'EUR'))).toBe('25.000,00 €')
    expect(plain(formatCurrency('0.5', 'USD'))).toBe('0,50 $')
    expect(formatCurrency(null, 'EUR')).toBe('–')
  })

  it('formatQuantity: bis zu 8 Nachkommastellen, ohne trailing zeros', async () => {
    const { formatQuantity } = await import('./format')
    expect(formatQuantity('0.50000000')).toBe('0,5')
    expect(formatQuantity('1234.12345678')).toBe('1.234,12345678')
  })

  it('formatRelativeTime: gestaffelte deutsche Texte', async () => {
    const { formatRelativeTime } = await import('./format')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-11T12:00:00Z'))

    expect(formatRelativeTime(null)).toBe('noch nie')
    expect(formatRelativeTime('2026-06-11T11:59:50Z')).toBe('gerade eben')
    expect(formatRelativeTime('2026-06-11T11:45:00Z')).toBe('vor 15 Min.')
    expect(formatRelativeTime('2026-06-11T09:00:00Z')).toBe('vor 3 Std.')
    // älter als 24h → Datum
    expect(formatRelativeTime('2026-06-01T09:00:00Z')).toContain('2026')

    vi.useRealTimers()
  })
})
