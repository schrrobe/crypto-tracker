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
  // Staking/reward variants like "ETH2.S", "SOL.S", "XBT.M" → base asset + account type
  const base = code.split('.')[0] ?? code
  if (SKIP.has(base)) return null
  return { symbol: ASSET_MAP[base] ?? base.toUpperCase(), accountType: accountTypeForKraken(code, base) }
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
