import { createHash, createHmac } from 'node:crypto'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Kraken REST API: POST /0/private/Balance mit HMAC-SHA512-Signatur.
// Benötigt einen API-Key mit ausschließlich "Query Funds"-Berechtigung (read-only).

const BASE_URL = 'https://api.kraken.com'
const BALANCE_PATH = '/0/private/Balance'

// API-Sign = HMAC-SHA512(path + SHA256(nonce + postData), base64decode(secret)), base64
export function krakenSignature(path: string, postData: string, nonce: string, secretB64: string): string {
  const message = Buffer.concat([
    Buffer.from(path, 'utf8'),
    createHash('sha256')
      .update(nonce + postData)
      .digest(),
  ])
  return createHmac('sha512', Buffer.from(secretB64, 'base64')).update(message).digest('base64')
}

// Kraken-Altcodes (X = Krypto-Prefix, Z = Fiat-Prefix) + Staking-Suffixe (.S/.M/.F/.B).
// Fiat und Fee-Credits liefern null → werden übersprungen (Portfolio trackt nur Krypto in V1).
const ASSET_MAP: Record<string, string> = {
  XXBT: 'BTC',
  XBT: 'BTC',
  XETH: 'ETH',
  XXRP: 'XRP',
  XLTC: 'LTC',
  XXLM: 'XLM',
  XXMR: 'XMR',
  XZEC: 'ZEC',
  XXDG: 'DOGE',
  XDG: 'DOGE',
  XETC: 'ETC',
  XREP: 'REP',
  ETH2: 'ETH', // gestaktes ETH
}

const SKIP = new Set([
  'ZEUR', 'ZUSD', 'ZGBP', 'ZCAD', 'ZJPY', 'ZCHF', 'ZAUD',
  'EUR', 'USD', 'GBP', 'CAD', 'JPY', 'CHF', 'AUD',
  'KFEE', // Kraken Fee Credits
])

export function normalizeKrakenAsset(code: string): string | null {
  // Staking-/Reward-Varianten wie "ETH2.S", "SOL.S", "XBT.M" → Basis-Asset
  const base = code.split('.')[0] ?? code
  if (SKIP.has(base)) return null
  return ASSET_MAP[base] ?? base.toUpperCase()
}

interface KrakenResponse {
  error: string[]
  result?: Record<string, string>
}

function classifyKrakenError(messages: string[]): ProviderError {
  const text = messages.join('; ')
  if (/Invalid key|Invalid signature|Invalid nonce|Permission denied/i.test(text)) {
    return new ProviderError('INVALID_API_KEY', `Kraken: ${text}`)
  }
  if (/Rate limit/i.test(text)) {
    return new ProviderError('RATE_LIMITED', `Kraken: ${text}`)
  }
  return new ProviderError('PROVIDER_ERROR', `Kraken: ${text}`)
}

async function fetchKrakenBalances(creds: ExchangeCredentials): Promise<RawBalance[]> {
  const nonce = Date.now().toString()
  const postData = `nonce=${nonce}`

  const res = await fetch(`${BASE_URL}${BALANCE_PATH}`, {
    method: 'POST',
    headers: {
      'API-Key': creds.apiKey,
      'API-Sign': krakenSignature(BALANCE_PATH, postData, nonce, creds.apiSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postData,
  })
  if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'Kraken Rate-Limit erreicht')
  if (!res.ok) throw new ProviderError('PROVIDER_ERROR', `Kraken antwortet mit ${res.status}`)

  const json = (await res.json()) as KrakenResponse
  if (json.error.length > 0) throw classifyKrakenError(json.error)

  const balances: RawBalance[] = []
  for (const [code, amount] of Object.entries(json.result ?? {})) {
    if (Number(amount) <= 0) continue
    const symbol = normalizeKrakenAsset(code)
    if (!symbol) continue
    // Gleiche Symbole (z.B. ETH + ETH2.S) werden im SyncService aufsummiert
    balances.push({ symbol, amount, meta: { krakenCode: code } })
  }
  return balances
}

export const krakenProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'KRAKEN',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // Balance ist ein reiner Lese-Endpoint — validiert Key, Secret und Berechtigung
    await fetchKrakenBalances(creds)
  },

  fetchBalances: fetchKrakenBalances,
}
