import { afterEach, describe, expect, it, vi } from 'vitest'
import { bitstampProvider, bitstampSignature } from './bitstamp'

// Realistic Bitstamp response (POST /api/v2/account_balances/)
const BALANCE_FIXTURE = [
  { currency: 'eur', total: '2500.50', available: '2500.50', reserved: '0' }, // fiat → skipped
  { currency: 'btc', total: '0.75000000', available: '0.50000000', reserved: '0.25000000' },
  { currency: 'eth', total: '3.00000000', available: '3.00000000', reserved: '0' },
  { currency: 'ada', total: '0.00000000', available: '0.00000000', reserved: '0' }, // zero balance → skipped
]

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const CREDS = { apiKey: 'testkey', apiSecret: 'bitstamp-secret' }

describe('bitstampSignature', () => {
  const PARTS = {
    apiKey: 'testkey',
    verb: 'POST',
    host: 'www.bitstamp.net',
    path: '/api/v2/account_balances/',
    query: '',
    contentType: '',
    nonce: 'd1f4f1f6-1c43-4f43-9e8f-2a3a08e9b9df',
    timestamp: '1700000000000',
    body: '',
  }

  it('entspricht dem vorab mit node:crypto berechneten Referenzwert', () => {
    // hex(HMAC-SHA256('BITSTAMP testkey' + 'POST' + 'www.bitstamp.net'
    //   + '/api/v2/account_balances/' + nonce + timestamp + 'v2', 'bitstamp-secret'))
    expect(bitstampSignature(PARTS, 'bitstamp-secret')).toBe(
      '5e992327d1a7b7058ba954c19c3eb0c87374be5310ad8b4e6573d62268835b51',
    )
  })

  it('lässt den Content-Type bei leerem Body aus dem Signatur-String weg', () => {
    // Docs: "Content-Type should not be added to the string if request.body is empty"
    const withContentType = bitstampSignature(
      { ...PARTS, contentType: 'application/x-www-form-urlencoded' },
      'bitstamp-secret',
    )
    expect(withContentType).toBe(bitstampSignature(PARTS, 'bitstamp-secret'))
    // for a non-empty body the Content-Type is included
    const withBody = { ...PARTS, body: 'offset=1', contentType: 'application/x-www-form-urlencoded' }
    expect(bitstampSignature(withBody, 'bitstamp-secret')).not.toBe(
      bitstampSignature({ ...withBody, contentType: '' }, 'bitstamp-secret'),
    )
  })

  it('jede Komponente verändert die Signatur', () => {
    const sig = bitstampSignature(PARTS, 'bitstamp-secret')
    expect(bitstampSignature({ ...PARTS, timestamp: '1700000000001' }, 'bitstamp-secret')).not.toBe(sig)
    expect(bitstampSignature({ ...PARTS, verb: 'GET' }, 'bitstamp-secret')).not.toBe(sig)
    expect(bitstampSignature({ ...PARTS, query: 'a=1' }, 'bitstamp-secret')).not.toBe(sig)
  })
})

describe('bitstampProvider.fetchBalances', () => {
  it('liefert Gesamtbestände (total), Symbole uppercase, ohne Fiat und Nullen', async () => {
    mockFetch(200, BALANCE_FIXTURE)
    const balances = await bitstampProvider.fetchBalances(CREDS)

    // total includes available + reserved
    expect(balances).toContainEqual({ symbol: 'BTC', amount: '0.75000000' })
    expect(balances).toContainEqual({ symbol: 'ETH', amount: '3.00000000' })
    expect(balances.map((b) => b.symbol)).not.toContain('EUR')
    expect(balances.map((b) => b.symbol)).not.toContain('ADA')
    expect(balances).toHaveLength(2)
  })

  it('sendet die X-Auth-Header mit konsistenter Signatur', async () => {
    const fn = mockFetch(200, [])
    await bitstampProvider.fetchBalances(CREDS)
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://www.bitstamp.net/api/v2/account_balances/')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['X-Auth']).toBe('BITSTAMP testkey')
    expect(headers['X-Auth-Version']).toBe('v2')
    expect(headers['X-Auth-Nonce']).toMatch(/^[0-9a-f-]{36}$/)
    expect(headers['X-Auth-Timestamp']).toMatch(/^\d+$/)
    // signature matches the sent nonce/timestamp headers
    expect(headers['X-Auth-Signature']).toBe(
      bitstampSignature(
        {
          apiKey: 'testkey',
          verb: 'POST',
          host: 'www.bitstamp.net',
          path: '/api/v2/account_balances/',
          query: '',
          contentType: '',
          nonce: headers['X-Auth-Nonce'] as string,
          timestamp: headers['X-Auth-Timestamp'] as string,
          body: '',
        },
        'bitstamp-secret',
      ),
    )
  })

  it('mappt 403 auf INVALID_API_KEY', async () => {
    mockFetch(403, { status: 'error', reason: 'Missing key, signature and nonce parameters.', code: 'API0004' })
    await expect(bitstampProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt API0xxx-Auth-Codes auch bei anderen HTTP-Status', async () => {
    mockFetch(400, { status: 'error', reason: 'X-Auth-Signature is invalid.', code: 'API0005' })
    await expect(bitstampProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt 429 auf RATE_LIMITED', async () => {
    mockFetch(429, {})
    await expect(bitstampProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('mappt Serverfehler auf PROVIDER_ERROR', async () => {
    mockFetch(500, { status: 'error', reason: 'Internal server error.' })
    await expect(bitstampProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })
})
