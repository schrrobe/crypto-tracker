import { createHmac } from 'node:crypto'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Crypto.com Exchange API v1: POST private/user-balance mit HMAC-SHA256-Signatur.
// Benötigt einen API-Key mit ausschließlich "Read"-Berechtigung.

const BASE_URL = 'https://api.crypto.com/exchange/v1'
const BALANCE_METHOD = 'private/user-balance'

// Params werden für die Signatur als key+value konkateniert, Keys alphabetisch
// sortiert; verschachtelte Objekte/Arrays rekursiv nach demselben Schema.
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

// 10002 = UNAUTHORIZED (Legacy), 40101 = UNAUTHORIZED (Key/Signatur falsch)
const AUTH_ERROR_CODES = new Set([10002, 40101])

// Fiat-/Stable-Sammelpositionen wie "USD" werden in V1 nicht getrackt
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
    // Auth-Fehler kommen sowohl als HTTP 401 als auch über den Body-Code
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
      // Mehrere Konten mit gleichem Symbol summiert der SyncService per Decimal
      if (Number(position.quantity) > 0) balances.push({ symbol, amount: position.quantity })
    }
  }
  return balances
}

export const cryptocomProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'CRYPTOCOM',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // user-balance ist ein reiner Lese-Endpoint — validiert Key und Secret
    await fetchCryptocomBalances(creds)
  },

  fetchBalances: fetchCryptocomBalances,
}
