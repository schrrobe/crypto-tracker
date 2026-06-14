import { afterEach, describe, expect, it, vi } from 'vitest'
import { gateioProvider, gateioSignature } from './gateio'

// Realistic Gate.io response (GET /api/v4/spot/accounts)
const BALANCE_FIXTURE = [
  { currency: 'BTC', available: '0.5', locked: '0.25' }, // both parts count
  { currency: 'ETH', available: '3', locked: '0' },
  { currency: 'USD', available: '100', locked: '0' }, // fiat → skipped
  { currency: 'ADA', available: '0', locked: '0' }, // zero balance → skipped
]

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const CREDS = { apiKey: 'test-key', apiSecret: 'gateio-secret' }

describe('gateioSignature', () => {
  it('entspricht dem vorab mit node:crypto berechneten Referenzwert', () => {
    // hex(HMAC-SHA512('GET\n/api/v4/spot/accounts\n\n' + sha512hex('') + '\n1700000000', 'gateio-secret'))
    expect(gateioSignature('GET', '/api/v4/spot/accounts', '', '', '1700000000', 'gateio-secret')).toBe(
      '8e88b6310abe68ad18ffdcb8b7b558ccc9b55961eb360ced342372061708932d0ececd5b8e2efd9232c6bf620d18d4bf0dbc94c7daf9174a5794550459259fe6',
    )
  })

  it('jede Komponente verändert die Signatur', () => {
    const sig = gateioSignature('GET', '/api/v4/spot/accounts', '', '', '1700000000', 'gateio-secret')
    expect(gateioSignature('POST', '/api/v4/spot/accounts', '', '', '1700000000', 'gateio-secret')).not.toBe(sig)
    expect(gateioSignature('GET', '/api/v4/spot/accounts', 'a=1', '', '1700000000', 'gateio-secret')).not.toBe(sig)
    expect(gateioSignature('GET', '/api/v4/spot/accounts', '', '{}', '1700000000', 'gateio-secret')).not.toBe(sig)
    expect(gateioSignature('GET', '/api/v4/spot/accounts', '', '', '1700000001', 'gateio-secret')).not.toBe(sig)
  })
})

describe('gateioProvider.fetchBalances', () => {
  it('liefert verfügbare und gesperrte Bestände, ohne Fiat und Nullen', async () => {
    mockFetch(200, BALANCE_FIXTURE)
    const balances = await gateioProvider.fetchBalances(CREDS)

    // BTC: available + locked as separate entries (SyncService sums them via Decimal)
    expect(balances.filter((b) => b.symbol === 'BTC').map((b) => b.amount)).toEqual(['0.5', '0.25'])
    expect(balances).toContainEqual({ symbol: 'ETH', amount: '3' })
    expect(balances.map((b) => b.symbol)).not.toContain('USD')
    expect(balances.map((b) => b.symbol)).not.toContain('ADA')
    expect(balances).toHaveLength(3)
  })

  it('sendet KEY, Timestamp (Sekunden) und SIGN', async () => {
    const fn = mockFetch(200, [])
    await gateioProvider.fetchBalances(CREDS)
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.gateio.ws/api/v4/spot/accounts')
    const headers = init.headers as Record<string, string>
    expect(headers.KEY).toBe('test-key')
    // seconds, not milliseconds (10 digits instead of 13)
    expect(headers.Timestamp).toMatch(/^\d{10}$/)
    // signature matches the sent timestamp
    expect(headers.SIGN).toBe(
      gateioSignature('GET', '/api/v4/spot/accounts', '', '', headers.Timestamp as string, 'gateio-secret'),
    )
  })

  it('mappt 401 auf INVALID_API_KEY', async () => {
    mockFetch(401, { label: 'INVALID_KEY', message: 'Invalid key provided' })
    await expect(gateioProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt Auth-Labels auch bei anderen HTTP-Status', async () => {
    mockFetch(400, { label: 'INVALID_SIGNATURE', message: 'Signature mismatch' })
    await expect(gateioProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt 429 auf RATE_LIMITED', async () => {
    mockFetch(429, { label: 'TOO_MANY_REQUESTS', message: 'Too many requests' })
    await expect(gateioProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('mappt Serverfehler auf PROVIDER_ERROR', async () => {
    mockFetch(500, { label: 'SERVER_ERROR', message: 'Internal error' })
    await expect(gateioProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })
})
