import { createHmac, randomUUID } from 'node:crypto'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Bitstamp REST API: POST /api/v2/account_balances/ mit X-Auth-Signatur (Version v2).
// Benötigt einen API-Key mit ausschließlich "Account balance"-Berechtigung (read-only).

const HOST = 'www.bitstamp.net'
const BALANCES_PATH = '/api/v2/account_balances/'
const AUTH_VERSION = 'v2'

// Signatur = hex(HMAC-SHA256(xAuth + verb + host + path + query + contentType
// + nonce + timestamp + version + body, secret)). Laut Doku wird der Content-Type
// bei leerem Body NICHT in den String aufgenommen — wir senden den Header dann
// auch nicht mit.
export function bitstampSignature(
  parts: {
    apiKey: string
    verb: string
    host: string
    path: string
    query: string
    contentType: string
    nonce: string
    timestamp: string
    body: string
  },
  secret: string,
): string {
  const message =
    `BITSTAMP ${parts.apiKey}` +
    parts.verb +
    parts.host +
    parts.path +
    parts.query +
    (parts.body === '' ? '' : parts.contentType) +
    parts.nonce +
    parts.timestamp +
    AUTH_VERSION +
    parts.body
  return createHmac('sha256', secret).update(message).digest('hex')
}

interface BitstampBalanceEntry {
  currency: string
  total: string
  available: string
  reserved: string
}

interface BitstampError {
  reason?: unknown
  code?: string
}

// Bitstamp führt Fiat-Konten — Fiat wird in V1 nicht getrackt
const SKIP = new Set(['EUR', 'USD', 'GBP', 'CHF'])

async function fetchBitstampBalances(creds: ExchangeCredentials): Promise<RawBalance[]> {
  if (!creds.apiSecret) throw new ProviderError('INVALID_API_KEY', 'Bitstamp: API-Secret fehlt')
  const nonce = randomUUID()
  const timestamp = Date.now().toString()
  const signature = bitstampSignature(
    {
      apiKey: creds.apiKey,
      verb: 'POST',
      host: HOST,
      path: BALANCES_PATH,
      query: '',
      contentType: '',
      nonce,
      timestamp,
      body: '',
    },
    creds.apiSecret,
  )

  const res = await fetch(`https://${HOST}${BALANCES_PATH}`, {
    method: 'POST',
    headers: {
      'X-Auth': `BITSTAMP ${creds.apiKey}`,
      'X-Auth-Signature': signature,
      'X-Auth-Nonce': nonce,
      'X-Auth-Timestamp': timestamp,
      'X-Auth-Version': AUTH_VERSION,
    },
  })

  if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'Bitstamp Rate-Limit erreicht')
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as BitstampError
    const message = typeof body.reason === 'string' ? body.reason : `HTTP ${res.status}`
    // API0xxx-Codes = Authentifizierung (ungültiger Key, falsche Signatur, fehlende Rechte)
    if (res.status === 401 || res.status === 403 || body.code?.startsWith('API0')) {
      throw new ProviderError('INVALID_API_KEY', `Bitstamp: ${message}`)
    }
    throw new ProviderError('PROVIDER_ERROR', `Bitstamp: ${message}`)
  }

  const entries = (await res.json()) as BitstampBalanceEntry[]
  const balances: RawBalance[] = []
  for (const entry of entries) {
    const symbol = entry.currency.toUpperCase()
    if (SKIP.has(symbol)) continue
    // total = available + reserved — Gesamtbestand laut Doku
    if (Number(entry.total) > 0) balances.push({ symbol, amount: entry.total })
  }
  return balances
}

export const bitstampProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'BITSTAMP',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // Account-Balances ist ein reiner Lese-Endpoint — validiert Key und Secret
    await fetchBitstampBalances(creds)
  },

  fetchBalances: fetchBitstampBalances,
}
