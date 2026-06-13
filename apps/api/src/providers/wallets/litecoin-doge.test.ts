import { afterEach, describe, expect, it, vi } from 'vitest'
import { dogecoinProvider, litecoinProvider } from './litecoin-doge'
import { ProviderError } from '../provider.types'

// Fixture nach echtem Blockchair-Response-Format
// (GET /{chain}/dashboards/address/{address}?limit=0) — Balance in Basis-Einheiten (1e8)
function dashboardFixture(address: string, balance: number | null) {
  return {
    data: {
      [address]: {
        address: {
          type: 'pubkeyhash',
          balance,
          balance_usd: 0,
          received: balance ?? 0,
          spent: 0,
          output_count: 1,
          unspent_output_count: 1,
          transaction_count: 1,
        },
      },
    },
    context: { code: 200 },
  }
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

// Live verifizierte Adressen (Blockchair-Richlist bzw. bekannte Explorer-Adressen)
const LTC_ADDRESS = 'MQd1fJwqBJvwLuyhr17PhEFx1swiqDbPQS'
const DOGE_ADDRESS = 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L'

describe('litecoinProvider', () => {
  it('akzeptiert gängige LTC-Adressformate', () => {
    expect(litecoinProvider.validateAddress(LTC_ADDRESS)).toBe(true) // P2SH (M…)
    expect(litecoinProvider.validateAddress('LaMT348PWRnrqeeWArpwQPbuanpXDZGEUz')).toBe(true) // Legacy (L…)
    expect(litecoinProvider.validateAddress('ltc1qhza9w2k0nuzwseqaq4y26r3z7d2tugz26nqnpx')).toBe(true) // Bech32
    expect(litecoinProvider.validateAddress(DOGE_ADDRESS)).toBe(false) // Dogecoin
    expect(litecoinProvider.validateAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBe(false) // Bitcoin
    expect(litecoinProvider.validateAddress('nicht-gueltig')).toBe(false)
  })

  it('liefert die LTC-Balance aus dem Dashboard', async () => {
    mockFetch(200, dashboardFixture(LTC_ADDRESS, 315_359_134_177_880))
    const balances = await litecoinProvider.fetchBalances(LTC_ADDRESS)
    expect(balances).toEqual([{ symbol: 'LTC', amount: '3153591.3417788' }])
  })

  it('filtert Nullbestände heraus (balance 0 und null)', async () => {
    mockFetch(200, dashboardFixture(LTC_ADDRESS, 0))
    expect(await litecoinProvider.fetchBalances(LTC_ADDRESS)).toEqual([])
    // Blockchair liefert null für nie benutzte Adressen
    mockFetch(200, dashboardFixture(LTC_ADDRESS, null))
    expect(await litecoinProvider.fetchBalances(LTC_ADDRESS)).toEqual([])
  })

  it('wirft RATE_LIMITED bei den Blockchair-Limit-Codes 430/402/435/429', async () => {
    for (const status of [430, 402, 435, 429]) {
      mockFetch(status, { data: null, context: { code: status, error: 'limit' } })
      await expect(litecoinProvider.fetchBalances(LTC_ADDRESS)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      })
    }
  })

  it('wirft INVALID_ADDRESS bei HTTP 400', async () => {
    mockFetch(400, { data: null, context: { code: 400, error: 'Malformed request' } })
    await expect(litecoinProvider.fetchBalances('xyz')).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    })
  })

  it('wirft PROVIDER_ERROR bei Serverfehlern und fehlenden Daten', async () => {
    mockFetch(503)
    await expect(litecoinProvider.fetchBalances(LTC_ADDRESS)).rejects.toBeInstanceOf(ProviderError)
    // 200, aber data enthält die Adresse nicht
    mockFetch(200, { data: null, context: { code: 200 } })
    await expect(litecoinProvider.fetchBalances(LTC_ADDRESS)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
  })
})

describe('dogecoinProvider', () => {
  it('akzeptiert nur Dogecoin-Adressen', () => {
    expect(dogecoinProvider.validateAddress(DOGE_ADDRESS)).toBe(true)
    expect(dogecoinProvider.validateAddress(LTC_ADDRESS)).toBe(false) // Litecoin
    expect(dogecoinProvider.validateAddress('D0H5yaieqoZN36fDVciNyRueRGvGLR3mr7')).toBe(false) // 0 ist kein Base58
    expect(dogecoinProvider.validateAddress('nicht-gueltig')).toBe(false)
  })

  it('liefert die DOGE-Balance aus dem Dashboard', async () => {
    mockFetch(200, dashboardFixture(DOGE_ADDRESS, 421_337_000_000))
    const balances = await dogecoinProvider.fetchBalances(DOGE_ADDRESS)
    expect(balances).toEqual([{ symbol: 'DOGE', amount: '4213.37' }])
  })

  it('fragt die Dogecoin-Chain ab', async () => {
    mockFetch(200, dashboardFixture(DOGE_ADDRESS, 100_000_000))
    await dogecoinProvider.fetchBalances(DOGE_ADDRESS)
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('/dogecoin/dashboards/address/'))
  })
})
