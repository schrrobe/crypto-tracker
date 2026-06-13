import { afterEach, describe, expect, it, vi } from 'vitest'
import { okxProvider, okxSignature } from './okx'

// Realistische OKX-Balance-Response (GET /api/v5/account/balance)
const BALANCE_FIXTURE = {
  code: '0',
  msg: '',
  data: [
    {
      details: [
        { ccy: 'BTC', cashBal: '0.5' },
        { ccy: 'USDT', cashBal: '4850.435693622894' },
        { ccy: 'ADA', cashBal: '0' }, // Nullbestand → übersprungen
      ],
    },
  ],
}

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const CREDS = { apiKey: 'test-key', apiSecret: 'geheim', passphrase: 'pass-123' }

describe('okxSignature', () => {
  it('berechnet Base64(HMAC-SHA256(timestamp + method + path + body))', () => {
    // Known-Answer-Test: vorab mit node:crypto berechnet
    const signature = okxSignature('2020-12-08T09:08:57.715Z', 'GET', '/api/v5/account/balance', '', 'geheim')
    expect(signature).toBe('bi3DL1Zl3UKiqqWdY8dn4uv0NO9hynDFs2xCHHfhppo=')
    // jede Komponente verändert die Signatur
    expect(okxSignature('2020-12-08T09:08:57.716Z', 'GET', '/api/v5/account/balance', '', 'geheim')).not.toBe(signature)
    expect(okxSignature('2020-12-08T09:08:57.715Z', 'POST', '/api/v5/account/balance', '', 'geheim')).not.toBe(signature)
  })
})

describe('okxProvider.fetchBalances', () => {
  it('liefert Bestände aus den Account-Details, ohne Nullen', async () => {
    mockFetch(200, BALANCE_FIXTURE)
    const balances = await okxProvider.fetchBalances(CREDS)

    expect(balances).toContainEqual({ symbol: 'BTC', amount: '0.5' })
    expect(balances).toContainEqual({ symbol: 'USDT', amount: '4850.435693622894' })
    expect(balances.map((b) => b.symbol)).not.toContain('ADA')
    expect(balances).toHaveLength(2)
  })

  it('sendet die vier OKX-Auth-Header mit ISO-Timestamp', async () => {
    const fn = mockFetch(200, { code: '0', data: [] })
    await okxProvider.fetchBalances(CREDS)
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://www.okx.com/api/v5/account/balance')
    const headers = init.headers as Record<string, string>
    expect(headers['OK-ACCESS-KEY']).toBe('test-key')
    expect(headers['OK-ACCESS-TIMESTAMP']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(headers['OK-ACCESS-PASSPHRASE']).toBe('pass-123')
    // Signatur muss zum gesendeten Timestamp passen
    expect(headers['OK-ACCESS-SIGN']).toBe(
      okxSignature(headers['OK-ACCESS-TIMESTAMP'] ?? '', 'GET', '/api/v5/account/balance', '', 'geheim'),
    )
  })

  it('mappt Auth-Fehlercodes (50111/50113) auf INVALID_API_KEY', async () => {
    mockFetch(401, { code: '50111', msg: 'Invalid OK-ACCESS-KEY' })
    await expect(okxProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })

    mockFetch(200, { code: '50113', msg: 'Invalid sign' })
    await expect(okxProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt 401 ohne bekannten Body-Code auf INVALID_API_KEY', async () => {
    mockFetch(401, { code: '1', msg: 'Unauthorized' })
    await expect(okxProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
  })

  it('mappt 429 und Code 50011 auf RATE_LIMITED', async () => {
    mockFetch(429, {})
    await expect(okxProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })

    mockFetch(200, { code: '50011', msg: 'Rate limit reached' })
    await expect(okxProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })

  it('mappt sonstige OKX-Fehler auf PROVIDER_ERROR', async () => {
    mockFetch(200, { code: '50001', msg: 'Service temporarily unavailable' })
    await expect(okxProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })

  it('wirft INVALID_API_KEY ohne Passphrase', async () => {
    await expect(okxProvider.fetchBalances({ apiKey: 'k', apiSecret: 's' })).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    })
  })
})
