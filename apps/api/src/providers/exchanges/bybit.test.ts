import { afterEach, describe, expect, it, vi } from 'vitest'
import { bybitProvider, bybitSignature, parseBybitPositions } from './bybit'

describe('parseBybitPositions', () => {
  it('normalisiert Linear-Positionen (Buy→LONG, Sell→SHORT)', () => {
    const positions = parseBybitPositions([
      { symbol: 'BTCUSDT', side: 'Buy', size: '0.5', avgPrice: '48000', markPrice: '50000', leverage: '5', unrealisedPnl: '1000', liqPrice: '40000' },
      { symbol: 'ETHUSDT', side: 'Sell', size: '2', avgPrice: '3100', markPrice: '3000', leverage: '3', unrealisedPnl: '200', liqPrice: '3600' },
      { symbol: 'SOLUSDT', side: 'Buy', size: '0' }, // closed → ignored
    ])
    expect(positions).toHaveLength(2)
    expect(positions[0]).toMatchObject({ baseSymbol: 'BTC', side: 'LONG', size: '0.5', quoteCurrency: 'USDT', leverage: 5 })
    expect(positions[1]).toMatchObject({ baseSymbol: 'ETH', side: 'SHORT', unrealizedPnl: '200' })
  })
})

// Realistic Bybit wallet response (GET /v5/account/wallet-balance?accountType=UNIFIED)
const WALLET_FIXTURE = {
  retCode: 0,
  retMsg: 'OK',
  result: {
    list: [
      {
        coin: [
          { coin: 'BTC', walletBalance: '0.5' },
          { coin: 'USDT', walletBalance: '1500.25' },
          { coin: 'ADA', walletBalance: '0' }, // zero balance → skipped
        ],
      },
    ],
  },
}

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const CREDS = { apiKey: 'test-key', apiSecret: 'geheim' }

describe('bybitSignature', () => {
  it('berechnet hex(HMAC-SHA256(timestamp + apiKey + recvWindow + queryString))', () => {
    // Known-answer test: precomputed with node:crypto
    const signature = bybitSignature('1658384314791', 'test-key', '5000', 'accountType=UNIFIED', 'geheim')
    expect(signature).toBe('98ee7c9d07062ec674daaa2510d346f75402acc70f289969b7981512a5ce5577')
    // every component changes the signature
    expect(bybitSignature('1658384314792', 'test-key', '5000', 'accountType=UNIFIED', 'geheim')).not.toBe(signature)
    expect(bybitSignature('1658384314791', 'other-key', '5000', 'accountType=UNIFIED', 'geheim')).not.toBe(signature)
  })
})

describe('bybitProvider.fetchBalances', () => {
  it('liefert Bestände aus dem Unified-Konto, ohne Nullen', async () => {
    mockFetch(200, WALLET_FIXTURE)
    const balances = await bybitProvider.fetchBalances(CREDS)

    expect(balances).toContainEqual({ symbol: 'BTC', amount: '0.5' })
    expect(balances).toContainEqual({ symbol: 'USDT', amount: '1500.25' })
    expect(balances.map((b) => b.symbol)).not.toContain('ADA')
    expect(balances).toHaveLength(2)
  })

  it('sendet die Bybit-Auth-Header mit passender Signatur', async () => {
    const fn = mockFetch(200, { retCode: 0, result: { list: [] } })
    await bybitProvider.fetchBalances(CREDS)
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.bybit.com/v5/account/wallet-balance?accountType=UNIFIED')
    const headers = init.headers as Record<string, string>
    expect(headers['X-BAPI-API-KEY']).toBe('test-key')
    expect(headers['X-BAPI-TIMESTAMP']).toMatch(/^\d+$/)
    expect(headers['X-BAPI-RECV-WINDOW']).toBe('5000')
    // signature must match the sent timestamp
    expect(headers['X-BAPI-SIGN']).toBe(
      bybitSignature(headers['X-BAPI-TIMESTAMP'] ?? '', 'test-key', '5000', 'accountType=UNIFIED', 'geheim'),
    )
  })

  it('mappt Auth-retCodes (10003/10004) auf INVALID_API_KEY', async () => {
    mockFetch(200, { retCode: 10003, retMsg: 'API key is invalid.' })
    await expect(bybitProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })

    mockFetch(200, { retCode: 10004, retMsg: 'Error sign, please check your signature generation algorithm.' })
    await expect(bybitProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt 401 auf INVALID_API_KEY', async () => {
    mockFetch(401, {})
    await expect(bybitProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt 429 und retCode 10006 auf RATE_LIMITED', async () => {
    mockFetch(429, {})
    await expect(bybitProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })

    mockFetch(200, { retCode: 10006, retMsg: 'Too many visits. Exceeded the API Rate Limit.' })
    await expect(bybitProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('mappt sonstige Bybit-Fehler auf PROVIDER_ERROR', async () => {
    mockFetch(200, { retCode: 10016, retMsg: 'Server error.' })
    await expect(bybitProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })

  it('wirft INVALID_API_KEY ohne Secret', async () => {
    await expect(bybitProvider.fetchBalances({ apiKey: 'k' })).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })
})
