import { createHash, createHmac } from 'node:crypto'
import type { HoldingAccountType } from '@prisma/client'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Kraken REST API: POST /0/private/Balance with HMAC-SHA512 signature.
// Requires an API key with only the "Query Funds" permission (read-only).

const BASE_URL = 'https://api.kraken.com'
const BALANCE_PATH = '/0/private/Balance'

// Kraken requires a strictly increasing nonce per API key. Date.now() alone
// collides when two requests land in the same millisecond (e.g. parallel
// background syncs), which Kraken rejects as "Invalid nonce". Scale ms→µs and
// keep a monotonic floor so a same-ms burst still yields distinct ascending
// values. Stateful by necessity; the signature below stays pure.
let lastNonce = 0
export function nextKrakenNonce(now: number = Date.now()): string {
  const candidate = now * 1000
  lastNonce = candidate > lastNonce ? candidate : lastNonce + 1
  return lastNonce.toString()
}

// API-Sign = HMAC-SHA512(path + SHA256(nonce + postData), base64decode(secret)), base64 encoded
export function krakenSignature(path: string, postData: string, nonce: string, secretB64: string): string {
  const message = Buffer.concat([
    Buffer.from(path, 'utf8'),
    createHash('sha256')
      .update(nonce + postData)
      .digest(),
  ])
  return createHmac('sha512', Buffer.from(secretB64, 'base64')).update(message).digest('base64')
}

// Kraken legacy codes (X = crypto prefix, Z = fiat prefix) + staking suffixes (.S/.M/.F/.B).
// Fiat and fee credits return null → skipped (the portfolio only tracks crypto in V1).
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
  ETH2: 'ETH', // staked ETH
}

const SKIP = new Set([
  'ZEUR', 'ZUSD', 'ZGBP', 'ZCAD', 'ZJPY', 'ZCHF', 'ZAUD',
  'EUR', 'USD', 'GBP', 'CAD', 'JPY', 'CHF', 'AUD',
  'KFEE', // Kraken Fee Credits
])

// The suffix determines the account type: .S = Staking (Earn), .M = Margin, .F = Auto-Earn,
// .B = Bonded (tradable → Spot). ETH2 is staked ETH → Earn.
function accountTypeForKraken(code: string, base: string): HoldingAccountType {
  const suffix = code.includes('.') ? code.slice(code.lastIndexOf('.') + 1).toUpperCase() : ''
  if (suffix === 'S' || suffix === 'F') return 'EARN'
  if (suffix === 'M') return 'MARGIN'
  if (base === 'ETH2') return 'EARN'
  return 'SPOT'
}

export function normalizeKrakenAsset(code: string): { symbol: string; accountType: HoldingAccountType } | null {
  // Staking/reward variants like "ETH2.S", "SOL.S", "XBT.M" → base asset + account type.
  // Uppercase before lookup so case-varied fiat ("eur") still hits SKIP and never leaks.
  const base = (code.split('.')[0] ?? code).toUpperCase()
  if (SKIP.has(base)) return null
  return { symbol: ASSET_MAP[base] ?? base, accountType: accountTypeForKraken(code, base) }
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
  if (!creds.apiSecret) throw new ProviderError('INVALID_API_KEY', 'Kraken: API-Secret fehlt')
  const nonce = nextKrakenNonce()
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

  // Kraken returns its { error: [...] } envelope even on non-2xx responses, so
  // parse the body before the status-only fallback — otherwise a 401 carrying
  // "EAPI:Invalid key" gets misclassified as PROVIDER_ERROR instead of INVALID_API_KEY.
  const json = (await res.json().catch(() => null)) as KrakenResponse | null
  // Guard error as an array: a malformed/gateway body like {} or {"message":…}
  // is a valid JSON object but has no error[], so json.error.length would throw
  // a raw TypeError before the status fallback. Treat any non-conforming body
  // as a provider error instead.
  if (json && Array.isArray(json.error) && json.error.length > 0) throw classifyKrakenError(json.error)
  if (!res.ok) throw new ProviderError('PROVIDER_ERROR', `Kraken antwortet mit ${res.status}`)
  if (!json || !Array.isArray(json.error)) throw new ProviderError('PROVIDER_ERROR', 'Kraken: ungültige Antwort')

  const balances: RawBalance[] = []
  for (const [code, amount] of Object.entries(json.result ?? {})) {
    if (Number(amount) <= 0) continue
    const mapped = normalizeKrakenAsset(code)
    if (!mapped) continue
    // ETH (Spot) and ETH2.S (Earn) now end up under different account types
    balances.push({ symbol: mapped.symbol, amount, accountType: mapped.accountType, meta: { krakenCode: code } })
  }
  return balances
}

export const krakenProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'KRAKEN',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // Balance is a read-only endpoint — validates key, secret and permission
    await fetchKrakenBalances(creds)
  },

  fetchBalances: fetchKrakenBalances,
}
