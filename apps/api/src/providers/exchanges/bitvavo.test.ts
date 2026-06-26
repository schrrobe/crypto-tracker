import { afterEach, describe, expect, it, vi } from 'vitest'
import { bitvavoProvider, bitvavoSignature } from './bitvavo'

// Realistic Bitvavo balance response (GET /v2/balance)
const BALANCE_FIXTURE = [
  { symbol: 'EUR', available: '2500.50', inOrder: '0' }, // fiat → skipped
  { symbol: 'BTC', available: '0.75', inOrder: '0.25' }, // both parts count
  { symbol: 'ETH', available: '3', inOrder: '0' },
  { symbol: 'ADA', available: '0', inOrder: '0' }, // zero balance → skipped
]

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const CREDS = { apiKey: 'test-key', apiSecret: 'test-secret' }

describe('bitvavoSignature', () => {
  it('berechnet HMAC-SHA256 über timestamp+method+path+body', () => {
    const sig = bitvavoSignature('1548183481067', 'GET', '/v2/balance', '', 'geheim')
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
    // Known-Answer-Test: fixer Digest gegen feste Eingaben — fängt Algorithmus-
    // Drift (hex statt base64, vertauschte Komponenten, falscher Hash)
    expect(sig).toBe('49ae69132ab9d106050aa8fcaed077d662c07e51b4774a11086c2c8626a563cf')
    // deterministic
    expect(bitvavoSignature('1548183481067', 'GET', '/v2/balance', '', 'geheim')).toBe(sig)
    // every component changes the signature
    expect(bitvavoSignature('1548183481068', 'GET', '/v2/balance', '', 'geheim')).not.toBe(sig)
    expect(bitvavoSignature('1548183481067', 'POST', '/v2/balance', '', 'geheim')).not.toBe(sig)
  })
})

describe('bitvavoProvider.fetchBalances', () => {
  it('liefert verfügbare und in Orders gebundene Bestände, ohne Fiat und Nullen', async () => {
    mockFetch(200, BALANCE_FIXTURE)
    const balances = await bitvavoProvider.fetchBalances(CREDS)

    // BTC: available + inOrder as separate entries (SyncService sums them via Decimal)
    expect(balances.filter((b) => b.symbol === 'BTC').map((b) => b.amount)).toEqual(['0.75', '0.25'])
    expect(balances).toContainEqual({ symbol: 'ETH', amount: '3' })
    expect(balances.map((b) => b.symbol)).not.toContain('EUR')
    expect(balances.map((b) => b.symbol)).not.toContain('ADA')
  })

  it('sendet die Bitvavo-Auth-Header', async () => {
    const fn = mockFetch(200, [])
    await bitvavoProvider.fetchBalances(CREDS)
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.bitvavo.com/v2/balance')
    const headers = init.headers as Record<string, string>
    expect(headers['bitvavo-access-key']).toBe('test-key')
    expect(headers['bitvavo-access-timestamp']).toMatch(/^\d+$/)
    expect(headers['bitvavo-access-signature']).toMatch(/^[0-9a-f]{64}$/)
  })

  it('mappt 403 auf INVALID_API_KEY', async () => {
    mockFetch(403, { errorCode: 305, error: 'No active API key found.' })
    await expect(bitvavoProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt Auth-Fehlercodes (3xx) auch bei anderen HTTP-Status', async () => {
    mockFetch(400, { errorCode: 311, error: 'Signature invalid.' })
    await expect(bitvavoProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt 429 auf RATE_LIMITED', async () => {
    mockFetch(429, {})
    await expect(bitvavoProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('mappt Serverfehler auf PROVIDER_ERROR', async () => {
    mockFetch(500, { errorCode: 101, error: 'Unknown error.' })
    await expect(bitvavoProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })
})
