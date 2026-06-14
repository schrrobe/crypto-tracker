import { createHmac } from 'node:crypto'
import type { HoldingAccountType } from '@prisma/client'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// KuCoin REST API: GET /api/v1/accounts mit HMAC-SHA256-Signatur (Key-Version 2).
// Benötigt einen API-Key mit ausschließlich "General"-Berechtigung (read-only)
// sowie die beim Key-Anlegen vergebene Passphrase.

const BASE_URL = 'https://api.kucoin.com'
const ACCOUNTS_PATH = '/api/v1/accounts'

// KC-API-SIGN = Base64(HMAC-SHA256(timestamp + method + path + body, secret))
export function kucoinSignature(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  secret: string,
): string {
  return createHmac('sha256', secret).update(`${timestamp}${method}${path}${body}`).digest('base64')
}

// Key-Version 2: Passphrase wird nicht im Klartext gesendet, sondern
// KC-API-PASSPHRASE = Base64(HMAC-SHA256(passphrase, secret))
export function kucoinPassphrase(passphrase: string, secret: string): string {
  return createHmac('sha256', secret).update(passphrase).digest('base64')
}

interface KucoinAccount {
  currency: string
  type: string // main | trade | margin | ...
  balance: string
}

interface KucoinResponse {
  code: string // '200000' = Erfolg
  msg?: string
  data?: KucoinAccount[]
}

// KuCoin-eigene Auth-Fehlercodes: 400003 = Key existiert nicht,
// 400004 = Passphrase falsch, 400005 = Signatur falsch
const AUTH_ERROR_CODES = new Set(['400003', '400004', '400005'])

// Kontotyp-Abbildung. Spot-Futures liegen auf einem eigenen Host
// (api-futures.kucoin.com) und bleiben in V1 außen vor.
const ACCOUNT_TYPE_MAP: Record<string, HoldingAccountType> = {
  main: 'SPOT',
  trade: 'SPOT',
  trade_hf: 'SPOT',
  margin: 'MARGIN',
  isolated: 'MARGIN',
  margin_v2: 'MARGIN',
  pool: 'EARN',
}

// Fiat wird in V1 nicht getrackt
const SKIP = new Set(['EUR', 'USD', 'GBP', 'CHF'])

async function fetchKucoinBalances(creds: ExchangeCredentials): Promise<RawBalance[]> {
  if (!creds.apiSecret) throw new ProviderError('INVALID_API_KEY', 'KuCoin: API-Secret fehlt')
  if (!creds.passphrase) throw new ProviderError('INVALID_API_KEY', 'KuCoin: Passphrase fehlt')

  const timestamp = Date.now().toString()
  const res = await fetch(`${BASE_URL}${ACCOUNTS_PATH}`, {
    headers: {
      'KC-API-KEY': creds.apiKey,
      'KC-API-SIGN': kucoinSignature(timestamp, 'GET', ACCOUNTS_PATH, '', creds.apiSecret),
      'KC-API-TIMESTAMP': timestamp,
      'KC-API-PASSPHRASE': kucoinPassphrase(creds.passphrase, creds.apiSecret),
      'KC-API-KEY-VERSION': '2',
    },
  })

  if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'KuCoin Rate-Limit erreicht')

  const json = (await res.json().catch(() => ({}))) as KucoinResponse
  if (json.code !== '200000') {
    const message = json.msg ?? `HTTP ${res.status}`
    // Auth-Fehler kommen sowohl als HTTP 401/403 als auch über den Body-Code
    if (res.status === 401 || res.status === 403 || AUTH_ERROR_CODES.has(json.code)) {
      throw new ProviderError('INVALID_API_KEY', `KuCoin: ${message}`)
    }
    throw new ProviderError('PROVIDER_ERROR', `KuCoin: ${message}`)
  }

  const balances: RawBalance[] = []
  for (const account of json.data ?? []) {
    const accountType = ACCOUNT_TYPE_MAP[account.type]
    if (!accountType) continue
    const symbol = account.currency.toUpperCase()
    if (SKIP.has(symbol)) continue
    // Konten als getrennte Einträge — der SyncService summiert gleiche Symbole je
    // Kontotyp per Decimal (kein float in der Provider-Schicht)
    if (Number(account.balance) > 0) balances.push({ symbol, amount: account.balance, accountType })
  }
  return balances
}

export const kucoinProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'KUCOIN',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // Accounts ist ein reiner Lese-Endpoint — validiert Key, Secret und Passphrase
    await fetchKucoinBalances(creds)
  },

  fetchBalances: fetchKucoinBalances,
}
