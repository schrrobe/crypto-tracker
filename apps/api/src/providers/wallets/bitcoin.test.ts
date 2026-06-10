import { afterEach, describe, expect, it, vi } from 'vitest'
import { bitcoinProvider } from './bitcoin'
import { ProviderError } from '../provider.types'

// Fixture nach echtem mempool.space-Response-Format (GET /api/address/:addr)
const ADDRESS_FIXTURE = {
  address: 'bc1qexample',
  chain_stats: {
    funded_txo_count: 5,
    funded_txo_sum: 150_000_000, // 1.5 BTC eingegangen
    spent_txo_count: 2,
    spent_txo_sum: 30_000_000, // 0.3 BTC ausgegeben
    tx_count: 7,
  },
  mempool_stats: {
    funded_txo_count: 1,
    funded_txo_sum: 5_000_000, // 0.05 BTC unbestätigt eingehend
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 1,
  },
}

function mockFetch(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('bitcoinProvider', () => {
  it('akzeptiert gängige Adressformate', () => {
    expect(bitcoinProvider.validateAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true) // Legacy
    expect(bitcoinProvider.validateAddress('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy')).toBe(true) // P2SH
    expect(bitcoinProvider.validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(true) // Bech32
    expect(bitcoinProvider.validateAddress('nicht-gueltig')).toBe(false)
    expect(bitcoinProvider.validateAddress('0x71C7656EC7ab88b098defB751B7401B5f6d8976F')).toBe(false) // ETH
  })

  it('berechnet Balance aus bestätigten + unbestätigten UTXOs', async () => {
    mockFetch(200, ADDRESS_FIXTURE)
    const balances = await bitcoinProvider.fetchBalances('bc1qexample')
    // 1.5 − 0.3 + 0.05 = 1.25 BTC
    expect(balances).toEqual([{ symbol: 'BTC', amount: '1.25' }])
  })

  it('wirft INVALID_ADDRESS bei HTTP 400', async () => {
    mockFetch(400)
    await expect(bitcoinProvider.fetchBalances('xyz')).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    })
  })

  it('wirft RATE_LIMITED bei HTTP 429', async () => {
    mockFetch(429)
    await expect(bitcoinProvider.fetchBalances('bc1qexample')).rejects.toBeInstanceOf(ProviderError)
    mockFetch(429)
    await expect(bitcoinProvider.fetchBalances('bc1qexample')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  it('wirft PROVIDER_ERROR bei Serverfehlern', async () => {
    mockFetch(503)
    await expect(bitcoinProvider.fetchBalances('bc1qexample')).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
  })
})
