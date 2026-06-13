import { afterEach, describe, expect, it, vi } from 'vitest'
import { tronProvider } from './tron'
import { ProviderError } from '../provider.types'

// Live verifizierte Adresse (USDT-Contract selbst, hält auch TRX)
const ADDRESS = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'

// Fixture nach echtem TronGrid-Response-Format (GET /v1/accounts/{address}) —
// balance in Sun (1e6), trc20 als Liste von {contractAdresse: betragString}
const ACCOUNT_FIXTURE = {
  data: [
    {
      address: '41a614f803b6fd780986a42c78ec9c7f77e6ded13c',
      balance: 1_075_165_255_653,
      trc20: [
        { [USDT_CONTRACT]: '2500000000' }, // 2500 USDT
        { TS6dcmkzuthz48t3HsWEmGxKGtv19icco1: '999666888000000000000000001' }, // Spam-Token → ignorieren
      ],
      account_resource: {},
      frozenV2: [],
      type: 0,
    },
  ],
  success: true,
  meta: { at: 1781311646000, page_size: 1 },
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

describe('tronProvider', () => {
  it('akzeptiert Tron-Adressen (T + 33 Base58-Zeichen)', () => {
    expect(tronProvider.validateAddress(ADDRESS)).toBe(true)
    expect(tronProvider.validateAddress('TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi')).toBe(true)
    expect(tronProvider.validateAddress('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6')).toBe(false) // zu kurz
    expect(tronProvider.validateAddress('T0r7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6')).toBe(false) // 0 ist kein Base58
    expect(tronProvider.validateAddress('0x71C7656EC7ab88b098defB751B7401B5f6d8976F')).toBe(false)
    expect(tronProvider.validateAddress('nicht-gueltig')).toBe(false)
  })

  it('liefert TRX-Balance und USDT aus der trc20-Liste, ignoriert Spam-Tokens', async () => {
    mockFetch(200, ACCOUNT_FIXTURE)
    const balances = await tronProvider.fetchBalances(ADDRESS)
    expect(balances).toEqual([
      { symbol: 'TRX', amount: '1075165.255653' },
      { symbol: 'USDT', amount: '2500', meta: { contract: USDT_CONTRACT } },
    ])
  })

  it('addiert Stake-2.0-Bestände aus frozenV2 zur TRX-Balance', async () => {
    mockFetch(200, {
      data: [
        {
          balance: 500_000,
          frozenV2: [
            { type: 'ENERGY', amount: 2_000_000 },
            { type: 'BANDWIDTH', amount: 1_500_000 },
          ],
        },
      ],
      success: true,
    })
    expect(await tronProvider.fetchBalances(ADDRESS)).toEqual([{ symbol: 'TRX', amount: '4' }])
  })

  it('behandelt leeres data als nicht aktiviertes Konto (kein Fehler)', async () => {
    mockFetch(200, { data: [], success: true, meta: {} })
    expect(await tronProvider.fetchBalances(ADDRESS)).toEqual([])
  })

  it('filtert Nullbestände heraus (fehlende balance, kein USDT)', async () => {
    // TronGrid lässt balance weg, wenn das Konto 0 TRX hält
    mockFetch(200, { data: [{ trc20: [] }], success: true, meta: {} })
    expect(await tronProvider.fetchBalances(ADDRESS)).toEqual([])
  })

  it('wirft INVALID_ADDRESS bei HTTP 400 (auch falsche Checksumme)', async () => {
    mockFetch(400, {
      success: false,
      error: 'A valid account address is required.',
      statusCode: 400,
    })
    await expect(
      tronProvider.fetchBalances('T1111111111111111111111111111111111'),
    ).rejects.toMatchObject({
      code: 'INVALID_ADDRESS',
    })
  })

  it('wirft RATE_LIMITED bei HTTP 429', async () => {
    mockFetch(429)
    await expect(tronProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
  })

  it('wirft PROVIDER_ERROR bei Serverfehlern und success=false', async () => {
    mockFetch(503)
    await expect(tronProvider.fetchBalances(ADDRESS)).rejects.toBeInstanceOf(ProviderError)
    mockFetch(200, { data: [], success: false })
    await expect(tronProvider.fetchBalances(ADDRESS)).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
    })
  })
})
