import { afterEach, describe, expect, it, vi } from 'vitest'
import { cryptocomParamsString, cryptocomProvider, cryptocomSignature } from './cryptocom'

// Realistische Crypto.com-Response (POST private/user-balance)
const BALANCE_FIXTURE = {
  id: 11,
  method: 'private/user-balance',
  code: 0,
  result: {
    data: [
      {
        instrument_name: 'USD',
        total_available_balance: '4721.05898582',
        position_balances: [
          { instrument_name: 'CRO', quantity: '24422.72427884', market_value: '4776.10' },
          { instrument_name: 'BTC', quantity: '0.5', market_value: '20000.00' },
          { instrument_name: 'USD', quantity: '100', market_value: '100' }, // Fiat → übersprungen
          { instrument_name: 'ADA', quantity: '0', market_value: '0' }, // Nullbestand → übersprungen
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

const CREDS = { apiKey: 'cdc-key', apiSecret: 'cdc-secret' }

describe('cryptocomParamsString', () => {
  it('konkateniert Keys alphabetisch sortiert als key+value', () => {
    expect(cryptocomParamsString({})).toBe('')
    expect(cryptocomParamsString({ b: '2', a: '1' })).toBe('a1b2')
    // verschachtelte Objekte/Arrays rekursiv nach demselben Schema
    expect(cryptocomParamsString({ c: { y: 'z', x: 1 }, a: [1, 2] })).toBe('a12cx1yz')
  })
})

describe('cryptocomSignature', () => {
  it('entspricht dem vorab mit node:crypto berechneten Referenzwert', () => {
    // hex(HMAC-SHA256('private/user-balance' + '42' + 'cdc-key' + '' + '1700000000000', 'cdc-secret'))
    expect(cryptocomSignature('private/user-balance', 42, 'cdc-key', {}, 1700000000000, 'cdc-secret')).toBe(
      '8642f3fb283035e1e957e6b78c021372fb56473fffb0c9292170ee6133c831ac',
    )
  })

  it('jede Komponente verändert die Signatur', () => {
    const sig = cryptocomSignature('private/user-balance', 42, 'cdc-key', {}, 1700000000000, 'cdc-secret')
    expect(cryptocomSignature('private/user-balance', 43, 'cdc-key', {}, 1700000000000, 'cdc-secret')).not.toBe(sig)
    expect(cryptocomSignature('private/user-balance', 42, 'cdc-key', {}, 1700000000001, 'cdc-secret')).not.toBe(sig)
    expect(cryptocomSignature('private/user-balance', 42, 'cdc-key', { a: '1' }, 1700000000000, 'cdc-secret')).not.toBe(sig)
  })
})

describe('cryptocomProvider.fetchBalances', () => {
  it('liefert position_balances, ohne Fiat und Nullen', async () => {
    mockFetch(200, BALANCE_FIXTURE)
    const balances = await cryptocomProvider.fetchBalances(CREDS)

    expect(balances).toContainEqual({ symbol: 'CRO', amount: '24422.72427884' })
    expect(balances).toContainEqual({ symbol: 'BTC', amount: '0.5' })
    expect(balances.map((b) => b.symbol)).not.toContain('USD')
    expect(balances.map((b) => b.symbol)).not.toContain('ADA')
    expect(balances).toHaveLength(2)
  })

  it('sendet einen signierten JSON-Request', async () => {
    const fn = mockFetch(200, { code: 0, result: { data: [] } })
    await cryptocomProvider.fetchBalances(CREDS)
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.crypto.com/exchange/v1/private/user-balance')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')

    const body = JSON.parse(String(init.body)) as {
      id: number
      method: string
      api_key: string
      params: Record<string, unknown>
      nonce: number
      sig: string
    }
    expect(body.method).toBe('private/user-balance')
    expect(body.api_key).toBe('cdc-key')
    expect(body.params).toEqual({})
    // Signatur passt zu den gesendeten id/nonce-Werten
    expect(body.sig).toBe(
      cryptocomSignature('private/user-balance', body.id, 'cdc-key', {}, body.nonce, 'cdc-secret'),
    )
  })

  it('mappt HTTP 401 auf INVALID_API_KEY', async () => {
    mockFetch(401, { code: 40101, message: 'UNAUTHORIZED' })
    await expect(cryptocomProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt Auth-Body-Codes (10002/40101) auch bei HTTP 200', async () => {
    mockFetch(200, { code: 10002, message: 'UNAUTHORIZED' })
    await expect(cryptocomProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
    mockFetch(200, { code: 40101, message: 'UNAUTHORIZED' })
    await expect(cryptocomProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt 429 auf RATE_LIMITED', async () => {
    mockFetch(429, { code: 42901, message: 'TOO_MANY_REQUESTS' })
    await expect(cryptocomProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('mappt sonstige Fehlercodes auf PROVIDER_ERROR', async () => {
    mockFetch(200, { code: 50001, message: 'SYS_ERROR' })
    await expect(cryptocomProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })
})
