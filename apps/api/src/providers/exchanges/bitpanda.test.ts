import { afterEach, describe, expect, it, vi } from 'vitest'
import { bitpandaProvider } from './bitpanda'

const WALLETS_FIXTURE = {
  data: [
    { type: 'wallet', attributes: { cryptocoin_symbol: 'BTC', balance: '0.75', deleted: false } },
    { type: 'wallet', attributes: { cryptocoin_symbol: 'ADA', balance: '0.00000000', deleted: false } },
    { type: 'wallet', attributes: { cryptocoin_symbol: 'ETH', balance: '3.2', deleted: true } },
    { type: 'wallet', attributes: { cryptocoin_symbol: 'sol', balance: '12', deleted: false } },
  ],
}

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({ ok: status < 300, status, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('bitpandaProvider.fetchBalances', () => {
  it('liefert aktive Wallets mit Bestand, normalisiert Symbole', async () => {
    const fn = mockFetch(200, WALLETS_FIXTURE)
    const balances = await bitpandaProvider.fetchBalances({ apiKey: 'test-key' })

    expect(balances).toEqual([
      { symbol: 'BTC', amount: '0.75' },
      { symbol: 'SOL', amount: '12' },
    ])
    // auth only via X-Api-Key, no secret
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.bitpanda.com/v1/wallets')
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('test-key')
  })

  it('mappt 401 auf INVALID_API_KEY', async () => {
    mockFetch(401, { errors: [{ status: 401 }] })
    await expect(bitpandaProvider.fetchBalances({ apiKey: 'bad' })).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    })
  })

  it('mappt 429 und Serverfehler', async () => {
    mockFetch(429, {})
    await expect(bitpandaProvider.fetchBalances({ apiKey: 'k' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
    mockFetch(500, {})
    await expect(bitpandaProvider.fetchBalances({ apiKey: 'k' })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
  })
})
