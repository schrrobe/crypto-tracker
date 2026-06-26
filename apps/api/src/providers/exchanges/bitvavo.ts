import { createHmac } from 'node:crypto'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Bitvavo REST API: GET /v2/balance with HMAC-SHA256 signature.
// Requires an API key with only the "View" permission (read-only).

const BASE_URL = 'https://api.bitvavo.com'
const BALANCE_PATH = '/v2/balance'

// Signature = HMAC-SHA256(timestamp + method + path + body, secret), hex
export function bitvavoSignature(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  secret: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}${method}${path}${body}`).digest('hex')
}

interface BitvavoBalanceEntry {
  symbol: string
  available: string
  inOrder: string
}

interface BitvavoError {
  errorCode?: number
  error?: string
}

// Bitvavo is a EUR exchange — fiat is not tracked in V1
const SKIP = new Set(['EUR'])

// Bitvavo returns standard tickers (no legacy aliases like Kraken's XXBT), so
// normalization is just casing + fiat skip. Pure and exported so the skip set
// is testable in isolation, separate from the HTTP client. Uppercase before
// the SKIP check so case-varied fiat ("eur") never leaks as a holding.
export function normalizeBitvavoAsset(symbol: string): string | null {
  const upper = symbol.toUpperCase()
  return SKIP.has(upper) ? null : upper
}

async function fetchBitvavoBalances(creds: ExchangeCredentials): Promise<RawBalance[]> {
  if (!creds.apiSecret) throw new ProviderError('INVALID_API_KEY', 'Bitvavo: API-Secret fehlt')
  const timestamp = Date.now().toString()
  const res = await fetch(`${BASE_URL}${BALANCE_PATH}`, {
    headers: {
      'bitvavo-access-key': creds.apiKey,
      'bitvavo-access-timestamp': timestamp,
      'bitvavo-access-signature': bitvavoSignature(timestamp, 'GET', BALANCE_PATH, '', creds.apiSecret),
      'bitvavo-access-window': '10000',
    },
  })

  if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'Bitvavo Rate-Limit erreicht')
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as BitvavoError
    const message = body.error ?? `HTTP ${res.status}`
    // 3xx error codes = authentication (invalid key, wrong signature, missing permissions)
    if (res.status === 401 || res.status === 403 || (body.errorCode && body.errorCode >= 300 && body.errorCode < 400)) {
      throw new ProviderError('INVALID_API_KEY', `Bitvavo: ${message}`)
    }
    throw new ProviderError('PROVIDER_ERROR', `Bitvavo: ${message}`)
  }

  const entries = (await res.json()) as BitvavoBalanceEntry[]
  const balances: RawBalance[] = []
  for (const entry of entries) {
    const symbol = normalizeBitvavoAsset(entry.symbol)
    if (!symbol) continue
    // available and inOrder as separate entries — the SyncService sums
    // identical symbols via Decimal (no float in the provider layer)
    for (const amount of [entry.available, entry.inOrder]) {
      if (Number(amount) > 0) balances.push({ symbol, amount })
    }
  }
  return balances
}

export const bitvavoProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'BITVAVO',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    await fetchBitvavoBalances(creds)
  },

  fetchBalances: fetchBitvavoBalances,
}
