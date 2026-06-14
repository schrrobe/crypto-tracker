import { createHmac } from 'node:crypto'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Crypto.com Exchange API v1: POST private/user-balance with HMAC-SHA256 signature.
// Requires an API key with only the "Read" permission.

const BASE_URL = 'https://api.crypto.com/exchange/v1'
const BALANCE_METHOD = 'private/user-balance'

// For the signature, params are concatenated as key+value with keys sorted
// alphabetically; nested objects/arrays are handled recursively by the same scheme.
export function cryptocomParamsString(params: unknown): string {
  if (params === null || params === undefined) return String(params)
  if (Array.isArray(params)) return params.map(cryptocomParamsString).join('')
  if (typeof params === 'object') {
    return Object.keys(params as Record<string, unknown>)
      .sort()
      .map((key) => key + cryptocomParamsString((params as Record<string, unknown>)[key]))
      .join('')
  }
  return String(params)
}

// sig = hex(HMAC-SHA256(method + id + api_key + paramsString + nonce, secret))
export function cryptocomSignature(
  method: string,
  id: number,
  apiKey: string,
  params: Record<string, unknown>,
  nonce: number,
  secret: string,
): string {
  const message = `${method}${id}${apiKey}${cryptocomParamsString(params)}${nonce}`
  return createHmac('sha256', secret).update(message).digest('hex')
}

interface CryptocomPositionBalance {
  instrument_name: string
  quantity: string
}

interface CryptocomResponse {
  code?: number
  message?: string
  result?: {
    data?: Array<{ position_balances?: CryptocomPositionBalance[] }>
  }
}

// 10002 = UNAUTHORIZED (legacy), 40101 = UNAUTHORIZED (wrong key/signature)
const AUTH_ERROR_CODES = new Set([10002, 40101])

// Fiat/stable aggregate positions like "USD" are not tracked in V1
const SKIP = new Set(['EUR', 'USD', 'GBP', 'CHF'])

async function fetchCryptocomBalances(creds: ExchangeCredentials): Promise<RawBalance[]> {
  if (!creds.apiSecret) throw new ProviderError('INVALID_API_KEY', 'Crypto.com: API-Secret fehlt')
  const id = Date.now()
  const nonce = Date.now()
  const params: Record<string, unknown> = {}
  const request = {
    id,
    method: BALANCE_METHOD,
    api_key: creds.apiKey,
    params,
    nonce,
    sig: cryptocomSignature(BALANCE_METHOD, id, creds.apiKey, params, nonce, creds.apiSecret),
  }

  const res = await fetch(`${BASE_URL}/${BALANCE_METHOD}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'Crypto.com Rate-Limit erreicht')

  const json = (await res.json().catch(() => ({}))) as CryptocomResponse
  if (!res.ok || json.code !== 0) {
    const message = json.message ?? `HTTP ${res.status}`
    // Auth errors arrive both as HTTP 401 and via the body code
    if (res.status === 401 || res.status === 403 || (json.code !== undefined && AUTH_ERROR_CODES.has(json.code))) {
      throw new ProviderError('INVALID_API_KEY', `Crypto.com: ${message}`)
    }
    throw new ProviderError('PROVIDER_ERROR', `Crypto.com: ${message}`)
  }

  const balances: RawBalance[] = []
  for (const account of json.result?.data ?? []) {
    for (const position of account.position_balances ?? []) {
      const symbol = position.instrument_name.toUpperCase()
      if (SKIP.has(symbol)) continue
      // Multiple accounts with the same symbol are summed by the SyncService via Decimal
      if (Number(position.quantity) > 0) balances.push({ symbol, amount: position.quantity })
    }
  }
  return balances
}

export const cryptocomProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'CRYPTOCOM',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // user-balance is a read-only endpoint — validates key and secret
    await fetchCryptocomBalances(creds)
  },

  fetchBalances: fetchCryptocomBalances,
}
