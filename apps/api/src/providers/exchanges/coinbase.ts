import jwt from 'jsonwebtoken'
import { randomBytes } from 'node:crypto'
import { fetchWithTimeout } from '../http'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Safety bound: stop paginating after this many pages (250 accounts each) even if
// the API keeps returning has_next — guards against a stuck/repeating cursor.
const MAX_PAGES = 50

// Coinbase Advanced Trade API with CDP keys: apiKey = key name
// ("organizations/{org}/apiKeys/{key}"), apiSecret = EC private key (PEM, ES256).
// A short-lived JWT (2 minutes) is signed per request.

const HOST = 'api.coinbase.com'
const ACCOUNTS_PATH = '/api/v3/brokerage/accounts'

// Users often paste the PEM on a single line with literal \n
export function normalizePrivateKey(pem: string): string {
  return pem.replace(/\\n/g, '\n').trim()
}

export function buildCoinbaseJwt(
  keyName: string,
  privateKeyPem: string,
  method: string,
  path: string,
): string {
  const now = Math.floor(Date.now() / 1000)
  return jwt.sign(
    {
      iss: 'cdp',
      sub: keyName,
      nbf: now,
      exp: now + 120,
      // URI without query string
      uri: `${method} ${HOST}${path}`,
    },
    privateKeyPem,
    {
      algorithm: 'ES256',
      header: { kid: keyName, nonce: randomBytes(16).toString('hex') } as unknown as jwt.JwtHeader,
    },
  )
}

interface CoinbaseAccount {
  currency: string
  type: string // ACCOUNT_TYPE_CRYPTO | ACCOUNT_TYPE_FIAT | ...
  available_balance: { value: string; currency: string }
  hold: { value: string; currency: string }
}

interface AccountsResponse {
  accounts: CoinbaseAccount[]
  has_next: boolean
  cursor: string
}

async function fetchCoinbaseBalances(creds: ExchangeCredentials): Promise<RawBalance[]> {
  if (!creds.apiSecret) throw new ProviderError('INVALID_API_KEY', 'Coinbase: Private Key fehlt')
  const privateKey = normalizePrivateKey(creds.apiSecret)

  const balances: RawBalance[] = []
  let cursor = ''
  let pages = 0
  do {
    if (++pages > MAX_PAGES) break
    let token: string
    try {
      token = buildCoinbaseJwt(creds.apiKey, privateKey, 'GET', ACCOUNTS_PATH)
    } catch {
      throw new ProviderError('INVALID_API_KEY', 'Coinbase: Private Key ist kein gültiger EC-Key (PEM)')
    }

    const query = `limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const res = await fetchWithTimeout(`https://${HOST}${ACCOUNTS_PATH}?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('INVALID_API_KEY', 'Coinbase: API-Key wurde abgelehnt')
    }
    if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'Coinbase Rate-Limit erreicht')
    if (!res.ok) throw new ProviderError('PROVIDER_ERROR', `Coinbase antwortet mit ${res.status}`)

    const data = (await res.json()) as AccountsResponse
    for (const account of data.accounts) {
      if (account.type === 'ACCOUNT_TYPE_FIAT') continue
      // available and hold kept separate — the SyncService sums identical symbols via Decimal
      for (const amount of [account.available_balance.value, account.hold.value]) {
        if (Number(amount) > 0) balances.push({ symbol: account.currency.toUpperCase(), amount })
      }
    }
    cursor = data.has_next ? data.cursor : ''
  } while (cursor)

  return balances
}

export const coinbaseProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'COINBASE',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    await fetchCoinbaseBalances(creds)
  },

  fetchBalances: fetchCoinbaseBalances,
}
