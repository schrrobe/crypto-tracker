import { createHash, createHmac } from 'node:crypto'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Gate.io REST API v4: GET /api/v4/spot/accounts with HMAC-SHA512 signature.
// Requires an API key with only the "Spot: read-only" permission.

const BASE_URL = 'https://api.gateio.ws'
const ACCOUNTS_PATH = '/api/v4/spot/accounts'

// SIGN = hex(HMAC-SHA512(method \n path \n query \n sha512hex(body) \n timestamp, secret))
export function gateioSignature(
  method: string,
  path: string,
  queryString: string,
  body: string,
  timestamp: string,
  secret: string,
): string {
  const bodyHash = createHash('sha512').update(body).digest('hex')
  const message = [method, path, queryString, bodyHash, timestamp].join('\n')
  return createHmac('sha512', secret).update(message).digest('hex')
}

interface GateioAccountEntry {
  currency: string
  available: string
  locked: string
}

interface GateioError {
  label?: string
  message?: string
}

// Auth labels per the Gate.io error docs (invalid key, wrong signature, missing permissions)
const AUTH_ERROR_LABELS = new Set([
  'INVALID_KEY',
  'INVALID_SIGNATURE',
  'FORBIDDEN',
  'READ_ONLY',
  'INVALID_CREDENTIALS',
  'MISSING_REQUIRED_HEADER',
  'REQUEST_EXPIRED',
  'IP_FORBIDDEN',
])

// Fiat is not tracked in V1
const SKIP = new Set(['EUR', 'USD', 'GBP', 'CHF'])

async function fetchGateioBalances(creds: ExchangeCredentials): Promise<RawBalance[]> {
  if (!creds.apiSecret) throw new ProviderError('INVALID_API_KEY', 'Gate.io: API-Secret fehlt')
  // Gate.io expects the timestamp in seconds
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const res = await fetch(`${BASE_URL}${ACCOUNTS_PATH}`, {
    headers: {
      KEY: creds.apiKey,
      Timestamp: timestamp,
      SIGN: gateioSignature('GET', ACCOUNTS_PATH, '', '', timestamp, creds.apiSecret),
    },
  })

  if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'Gate.io Rate-Limit erreicht')
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as GateioError
    const message = body.message ?? `HTTP ${res.status}`
    if (res.status === 401 || res.status === 403 || (body.label && AUTH_ERROR_LABELS.has(body.label))) {
      throw new ProviderError('INVALID_API_KEY', `Gate.io: ${message}`)
    }
    throw new ProviderError('PROVIDER_ERROR', `Gate.io: ${message}`)
  }

  const entries = (await res.json()) as GateioAccountEntry[]
  const balances: RawBalance[] = []
  for (const entry of entries) {
    const symbol = entry.currency.toUpperCase()
    if (SKIP.has(symbol)) continue
    // available and locked as separate entries — the SyncService sums
    // identical symbols via Decimal (no float in the provider layer)
    for (const amount of [entry.available, entry.locked]) {
      if (Number(amount) > 0) balances.push({ symbol, amount })
    }
  }
  return balances
}

export const gateioProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'GATEIO',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // Spot accounts is a pure read endpoint — validates key and secret
    await fetchGateioBalances(creds)
  },

  fetchBalances: fetchGateioBalances,
}
