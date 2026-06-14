import { afterEach, describe, expect, it, vi } from 'vitest'
import { binanceProvider, binanceSignature, normalizeBinanceAsset } from './binance'

// Realistische Binance-Account-Response (GET /api/v3/account)
const ACCOUNT_FIXTURE = {
  balances: [
    { asset: 'BTC', free: '0.75', locked: '0.25' }, // beide Teile zählen
    { asset: 'ETH', free: '3', locked: '0.00000000' },
    { asset: 'LDBTC', free: '0.1', locked: '0' }, // Binance Earn → BTC
    { asset: 'EUR', free: '2500.50', locked: '0' }, // Fiat → übersprungen
    { asset: 'ADA', free: '0.00000000', locked: '0.00000000' }, // Nullbestand → übersprungen
  ],
}

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const CREDS = { apiKey: 'test-key', apiSecret: 'test-secret' }

describe('binanceSignature', () => {
  it('entspricht dem offiziellen Beispiel aus der Binance-Doku', () => {
    // https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md (SIGNED Endpoint Examples)
    const signature = binanceSignature(
      'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559',
      'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j',
    )
    expect(signature).toBe('c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71')
  })
})

describe('normalizeBinanceAsset', () => {
  it('strippt das LD-Präfix von Binance-Earn-Assets', () => {
    expect(normalizeBinanceAsset('LDBTC')).toBe('BTC')
    expect(normalizeBinanceAsset('LDUSDT')).toBe('USDT')
    expect(normalizeBinanceAsset('LDLDO')).toBe('LDO') // Lido im Earn-Konto
  })

  it('lässt echte Assets unangetastet', () => {
    expect(normalizeBinanceAsset('BTC')).toBe('BTC')
    expect(normalizeBinanceAsset('LDO')).toBe('LDO') // beginnt mit LD, ist aber kein Earn-Asset
    expect(normalizeBinanceAsset('sol')).toBe('SOL')
  })
})

describe('binanceProvider.fetchBalances', () => {
  it('liefert freie und gesperrte Bestände, ohne Fiat und Nullen', async () => {
    mockFetch(200, ACCOUNT_FIXTURE)
    const balances = await binanceProvider.fetchBalances(CREDS)

    // BTC: free + locked als getrennte SPOT-Einträge (SyncService summiert per Decimal),
    // plus LDBTC aus dem Earn-Konto — jetzt als EARN getaggt, nicht in Spot gefaltet
    expect(balances.filter((b) => b.symbol === 'BTC').map((b) => b.amount)).toEqual(['0.75', '0.25', '0.1'])
    expect(balances).toContainEqual({ symbol: 'ETH', amount: '3', accountType: 'SPOT', meta: { binanceAsset: 'ETH' } })
    expect(balances).toContainEqual({ symbol: 'BTC', amount: '0.1', accountType: 'EARN', meta: { binanceAsset: 'LDBTC' } })
    // die beiden Spot-BTC-Einträge sind SPOT
    expect(balances.filter((b) => b.symbol === 'BTC' && b.accountType === 'SPOT')).toHaveLength(2)
    expect(balances.map((b) => b.symbol)).not.toContain('EUR')
    expect(balances.map((b) => b.symbol)).not.toContain('ADA')
    expect(balances).toHaveLength(4)
  })

  it('sendet API-Key-Header und signierten Query-String', async () => {
    const fn = mockFetch(200, { balances: [] })
    await binanceProvider.fetchBalances(CREDS)
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/^https:\/\/api\.binance\.com\/api\/v3\/account\?recvWindow=5000&timestamp=\d+&signature=[0-9a-f]{64}$/)
    const headers = init.headers as Record<string, string>
    expect(headers['X-MBX-APIKEY']).toBe('test-key')
  })

  it('mappt 401 auf INVALID_API_KEY', async () => {
    mockFetch(401, { code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' })
    await expect(binanceProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt Auth-Fehlercodes (-2014/-2015) auch bei anderen HTTP-Status', async () => {
    mockFetch(400, { code: -2014, msg: 'API-key format invalid.' })
    await expect(binanceProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt 429 auf RATE_LIMITED', async () => {
    mockFetch(429, {})
    await expect(binanceProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('mappt 418 (IP-Ban) auf RATE_LIMITED', async () => {
    mockFetch(418, {})
    await expect(binanceProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('mappt Serverfehler auf PROVIDER_ERROR', async () => {
    mockFetch(500, { code: -1000, msg: 'An unknown error occurred while processing the request.' })
    await expect(binanceProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })

  it('wirft INVALID_API_KEY ohne Secret', async () => {
    await expect(binanceProvider.fetchBalances({ apiKey: 'k' })).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })
})
