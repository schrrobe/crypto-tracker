import { afterEach, describe, expect, it, vi } from 'vitest'
import { kucoinPassphrase, kucoinProvider, kucoinSignature } from './kucoin'

// Realistische KuCoin-Accounts-Response (GET /api/v1/accounts)
const BALANCE_FIXTURE = {
  code: '200000',
  data: [
    { currency: 'BTC', type: 'main', balance: '0.5', available: '0.5', holds: '0' },
    { currency: 'BTC', type: 'trade', balance: '0.25', available: '0.2', holds: '0.05' },
    { currency: 'ETH', type: 'trade', balance: '3', available: '3', holds: '0' },
    { currency: 'SOL', type: 'margin', balance: '10', available: '10', holds: '0' }, // Margin → übersprungen
    { currency: 'USD', type: 'main', balance: '100', available: '100', holds: '0' }, // Fiat → übersprungen
    { currency: 'ADA', type: 'main', balance: '0', available: '0', holds: '0' }, // Nullbestand → übersprungen
  ],
}

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const CREDS = { apiKey: 'test-key', apiSecret: 'kucoin-secret', passphrase: 'kucoin-pass' }

describe('kucoinSignature', () => {
  it('entspricht dem vorab mit node:crypto berechneten Referenzwert', () => {
    // Base64(HMAC-SHA256('1700000000000' + 'GET' + '/api/v1/accounts', 'kucoin-secret'))
    expect(kucoinSignature('1700000000000', 'GET', '/api/v1/accounts', '', 'kucoin-secret')).toBe(
      '/7LdZ1jkrq6rqL5xZoYgjiFGDwPB2EGLUKfZpkLhbas=',
    )
    // jede Komponente verändert die Signatur
    expect(kucoinSignature('1700000000001', 'GET', '/api/v1/accounts', '', 'kucoin-secret')).not.toBe(
      kucoinSignature('1700000000000', 'GET', '/api/v1/accounts', '', 'kucoin-secret'),
    )
  })

  it('verschlüsselt die Passphrase nach Key-Version 2', () => {
    // Base64(HMAC-SHA256('kucoin-pass', 'kucoin-secret'))
    expect(kucoinPassphrase('kucoin-pass', 'kucoin-secret')).toBe('OplStk3M/IYYslJlMpTMb7auKQZQhD1g+JEQkER3KkA=')
  })
})

describe('kucoinProvider.fetchBalances', () => {
  it('liefert main- und trade-Bestände, ohne Margin, Fiat und Nullen', async () => {
    mockFetch(200, BALANCE_FIXTURE)
    const balances = await kucoinProvider.fetchBalances(CREDS)

    // BTC: main + trade als getrennte Einträge (SyncService summiert per Decimal)
    expect(balances.filter((b) => b.symbol === 'BTC').map((b) => b.amount)).toEqual(['0.5', '0.25'])
    expect(balances).toContainEqual({ symbol: 'ETH', amount: '3' })
    expect(balances.map((b) => b.symbol)).not.toContain('SOL')
    expect(balances.map((b) => b.symbol)).not.toContain('USD')
    expect(balances.map((b) => b.symbol)).not.toContain('ADA')
    expect(balances).toHaveLength(3)
  })

  it('sendet die KuCoin-Auth-Header (Key-Version 2)', async () => {
    const fn = mockFetch(200, { code: '200000', data: [] })
    await kucoinProvider.fetchBalances(CREDS)
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.kucoin.com/api/v1/accounts')
    const headers = init.headers as Record<string, string>
    expect(headers['KC-API-KEY']).toBe('test-key')
    expect(headers['KC-API-TIMESTAMP']).toMatch(/^\d+$/)
    expect(headers['KC-API-KEY-VERSION']).toBe('2')
    // Signatur passt zum gesendeten Timestamp
    expect(headers['KC-API-SIGN']).toBe(
      kucoinSignature(headers['KC-API-TIMESTAMP'] as string, 'GET', '/api/v1/accounts', '', 'kucoin-secret'),
    )
    expect(headers['KC-API-PASSPHRASE']).toBe('OplStk3M/IYYslJlMpTMb7auKQZQhD1g+JEQkER3KkA=')
  })

  it('wirft INVALID_API_KEY ohne Passphrase', async () => {
    await expect(kucoinProvider.fetchBalances({ apiKey: 'k', apiSecret: 's' })).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    })
  })

  it('mappt HTTP 401 auf INVALID_API_KEY', async () => {
    mockFetch(401, { code: '400003', msg: 'KC-API-KEY not exists' })
    await expect(kucoinProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt KuCoin-Auth-Fehlercodes auch bei HTTP 200', async () => {
    mockFetch(200, { code: '400004', msg: 'KC-API-PASSPHRASE error' })
    await expect(kucoinProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
    mockFetch(200, { code: '400005', msg: 'Signature error' })
    await expect(kucoinProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt 429 auf RATE_LIMITED', async () => {
    mockFetch(429, { code: '429000', msg: 'Too Many Requests' })
    await expect(kucoinProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('mappt sonstige Fehlercodes auf PROVIDER_ERROR', async () => {
    mockFetch(500, { code: '500000', msg: 'Internal Server Error' })
    await expect(kucoinProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })
})
