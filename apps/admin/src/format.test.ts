import { describe, expect, it } from 'vitest'
import { money, date } from './format'

describe('money', () => {
  it('formats cents to currency', () => {
    expect(money(1000)).toBe('10.00 EUR')
    expect(money(250, 'usd')).toBe('2.50 USD')
    expect(money(0)).toBe('0.00 EUR')
  })
})

describe('date', () => {
  it('returns dash for null', () => {
    expect(date(null)).toBe('–')
  })
  it('formats an ISO date', () => {
    expect(date('2026-06-19T00:00:00.000Z')).toMatch(/\d{1,2}\.\d{1,2}\.\d{4}/)
  })
})
