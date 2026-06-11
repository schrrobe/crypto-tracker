import { createHmac } from 'node:crypto'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Bitvavo REST API: GET /v2/balance mit HMAC-SHA256-Signatur.
// Benötigt einen API-Key mit ausschließlich "View"-Berechtigung (read-only).

const BASE_URL = 'https://api.bitvavo.com'
const BALANCE_PATH = '/v2/balance'

// Signatur = HMAC-SHA256(timestamp + method + path + body, secret), hex
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

// Bitvavo ist eine EUR-Börse — Fiat wird in V1 nicht getrackt
const SKIP = new Set(['EUR'])

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
    // 3xx-Fehlercodes = Authentifizierung (ungültiger Key, falsche Signatur, fehlende Rechte)
    if (res.status === 401 || res.status === 403 || (body.errorCode && body.errorCode >= 300 && body.errorCode < 400)) {
      throw new ProviderError('INVALID_API_KEY', `Bitvavo: ${message}`)
    }
    throw new ProviderError('PROVIDER_ERROR', `Bitvavo: ${message}`)
  }

  const entries = (await res.json()) as BitvavoBalanceEntry[]
  const balances: RawBalance[] = []
  for (const entry of entries) {
    if (SKIP.has(entry.symbol)) continue
    // available und inOrder als getrennte Einträge — der SyncService summiert
    // gleiche Symbole per Decimal (kein float in der Provider-Schicht)
    for (const amount of [entry.available, entry.inOrder]) {
      if (Number(amount) > 0) balances.push({ symbol: entry.symbol.toUpperCase(), amount })
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
