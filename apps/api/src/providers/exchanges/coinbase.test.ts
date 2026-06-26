import { generateKeyPairSync } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCoinbaseJwt, coinbaseProvider, normalizePrivateKey } from './coinbase'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const PRIVATE_PEM = privateKey.export({ type: 'sec1', format: 'pem' }).toString()
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const KEY_NAME = 'organizations/test-org/apiKeys/test-key'
const CREDS = { apiKey: KEY_NAME, apiSecret: PRIVATE_PEM }

function account(currency: string, type: string, available: string, hold = '0') {
  return {
    currency,
    type,
    available_balance: { value: available, currency },
    hold: { value: hold, currency },
  }
}

function mockFetch(pages: Array<{ status?: number; body: unknown }>) {
  const fn = vi.fn()
  for (const page of pages) {
    const status = page.status ?? 200
    fn.mockResolvedValueOnce({ ok: status < 300, status, json: async () => page.body })
  }
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('buildCoinbaseJwt', () => {
  it('signiert ein ES256-JWT mit CDP-Claims', () => {
    const token = buildCoinbaseJwt(KEY_NAME, PRIVATE_PEM, 'GET', '/api/v3/brokerage/accounts')
    const payload = jwt.verify(token, PUBLIC_PEM, { algorithms: ['ES256'] }) as jwt.JwtPayload
    expect(payload.iss).toBe('cdp')
    expect(payload.sub).toBe(KEY_NAME)
    expect(payload.uri).toBe('GET api.coinbase.com/api/v3/brokerage/accounts')
    expect(payload.exp! - payload.nbf!).toBe(120)

    const header = jwt.decode(token, { complete: true })!.header as jwt.JwtHeader & { nonce: string }
    expect(header.alg).toBe('ES256')
    expect(header.kid).toBe(KEY_NAME)
    expect(header.nonce).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('normalizePrivateKey', () => {
  it('wandelt literale \\n in Zeilenumbrüche', () => {
    const singleLine = PRIVATE_PEM.replace(/\n/g, '\\n')
    expect(normalizePrivateKey(singleLine)).toBe(PRIVATE_PEM.trim())
  })
})

describe('coinbaseProvider.fetchBalances', () => {
  it('paginiert, überspringt Fiat und liefert available + hold', async () => {
    mockFetch([
      {
        body: {
          accounts: [
            account('BTC', 'ACCOUNT_TYPE_CRYPTO', '0.5', '0.1'),
            account('EUR', 'ACCOUNT_TYPE_FIAT', '1000'),
          ],
          has_next: true,
          cursor: 'page2',
        },
      },
      {
        body: {
          accounts: [account('SOL', 'ACCOUNT_TYPE_CRYPTO', '25')],
          has_next: false,
          cursor: '',
        },
      },
    ])

    const balances = await coinbaseProvider.fetchBalances(CREDS)
    expect(balances).toEqual([
      { symbol: 'BTC', amount: '0.5' },
      { symbol: 'BTC', amount: '0.1' },
      { symbol: 'SOL', amount: '25' },
    ])
  })

  it('wirft PROVIDER_ERROR statt Teildaten, wenn der Cursor sich wiederholt', async () => {
    // Same cursor returned twice with has_next=true → server loops the same page.
    mockFetch([
      { body: { accounts: [account('BTC', 'ACCOUNT_TYPE_CRYPTO', '1')], has_next: true, cursor: 'stuck' } },
      { body: { accounts: [account('BTC', 'ACCOUNT_TYPE_CRYPTO', '1')], has_next: true, cursor: 'stuck' } },
    ])
    await expect(coinbaseProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })

  it('wirft INVALID_API_KEY bei kaputtem PEM ohne API-Call', async () => {
    const fn = mockFetch([])
    await expect(
      coinbaseProvider.fetchBalances({ apiKey: KEY_NAME, apiSecret: 'kein-pem' }),
    ).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
    expect(fn).not.toHaveBeenCalled()
  })

  it('mappt 401 auf INVALID_API_KEY und 429 auf RATE_LIMITED', async () => {
    mockFetch([{ status: 401, body: {} }])
    await expect(coinbaseProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'INVALID_API_KEY' })
    mockFetch([{ status: 429, body: {} }])
    await expect(coinbaseProvider.fetchBalances(CREDS)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
  })
})
