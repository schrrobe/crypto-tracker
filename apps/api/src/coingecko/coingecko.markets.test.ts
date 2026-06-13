import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../config/env'
import { fetchMarketChart, fetchMarkets } from './coingecko.client'

// Tests laufen sonst mit FAKE_PRICES=true (vitest.config). Hier prüfen wir den
// echten CoinGecko-Pfad inkl. Rate-Limit-Resilienz und schalten Fakes lokal aus.

function okResponse(coins: unknown[]): Response {
  return { ok: true, status: 200, json: async () => coins } as unknown as Response
}
function errorResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}) } as unknown as Response
}

const SAMPLE = [
  {
    id: 'bitcoin',
    symbol: 'btc',
    name: 'Bitcoin',
    image: 'http://x/btc.png',
    current_price: 50000,
    market_cap: 1_000_000,
    market_cap_rank: 1,
    price_change_percentage_24h: 1.5,
  },
]

describe('fetchMarkets (echter Pfad, Rate-Limit-Resilienz)', () => {
  const originalFake = env.FAKE_PRICES

  beforeEach(() => {
    env.FAKE_PRICES = false
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T00:00:00Z'))
  })

  afterEach(() => {
    env.FAKE_PRICES = originalFake
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('liefert bei 429 den letzten bekannten Cache-Stand statt zu werfen', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(okResponse(SAMPLE))
    vi.stubGlobal('fetch', fetchMock)

    // 'usd' füllt den Cache
    const first = await fetchMarkets('usd')
    expect(first).toHaveLength(1)
    expect(first[0]?.symbol).toBe('BTC')

    // Cache ablaufen lassen → erzwingt erneuten Abruf
    vi.setSystemTime(new Date('2026-06-13T00:02:00Z'))
    fetchMock.mockResolvedValueOnce(errorResponse(429))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const second = await fetchMarkets('usd')
    // alter Stand wird geliefert, kein Fehler
    expect(second).toEqual(first)
    expect(warn).toHaveBeenCalled()
  })

  it('wirft bei 429 ohne jeden Cache (Kaltstart)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(429)))
    // 'eur' wurde in diesem Test noch nie erfolgreich abgerufen
    await expect(fetchMarkets('eur')).rejects.toThrow()
  })

  it('Nicht-JSON-Antwort (200) → sauberer 502 statt roher SyntaxError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON')
        },
      } as unknown as Response),
    )
    // 'eur' hat keinen Cache → Fehler wird gereicht, aber als AppError(502)
    await expect(fetchMarkets('eur')).rejects.toMatchObject({ status: 502 })
  })
})

function chartResponse(prices: Array<[number, number]>): Response {
  return { ok: true, status: 200, json: async () => ({ prices }) } as unknown as Response
}

describe('fetchMarketChart (Rate-Limit-Resilienz)', () => {
  const originalFake = env.FAKE_PRICES

  beforeEach(() => {
    env.FAKE_PRICES = false
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T00:00:00Z'))
  })
  afterEach(() => {
    env.FAKE_PRICES = originalFake
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('liefert bei 429 den letzten Cache-Stand statt zu werfen', async () => {
    const points: Array<[number, number]> = [[1, 100]]
    const fetchMock = vi.fn().mockResolvedValueOnce(chartResponse(points))
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchMarketChart('solana', 'eur', 1)
    expect(first).toEqual(points)

    vi.setSystemTime(new Date('2026-06-13T00:40:00Z')) // Cache (30 min) abgelaufen
    fetchMock.mockResolvedValueOnce(errorResponse(429))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const second = await fetchMarketChart('solana', 'eur', 1)
    expect(second).toEqual(first)
  })

  it('wirft bei 429 ohne Cache (Kaltstart)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(429)))
    await expect(fetchMarketChart('cardano', 'eur', 7)).rejects.toMatchObject({ status: 502 })
  })
})
