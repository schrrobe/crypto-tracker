import { createHmac } from 'node:crypto'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Bybit REST API v5: GET /v5/account/wallet-balance (Unified Trading Account)
// mit HMAC-SHA256-Signatur. Benötigt einen API-Key mit ausschließlich Lese-Berechtigung.

const BASE_URL = 'https://api.bybit.com'
const WALLET_PATH = '/v5/account/wallet-balance'
const QUERY = 'accountType=UNIFIED'
const RECV_WINDOW = '5000'

// X-BAPI-SIGN = HMAC-SHA256(timestamp + apiKey + recvWindow + queryString, secret), hex
export function bybitSignature(
  timestamp: string,
  apiKey: string,
  recvWindow: string,
  queryString: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}${apiKey}${recvWindow}${queryString}`)
    .digest('hex')
}

interface BybitWalletResponse {
  retCode: number
  retMsg?: string
  result?: { list?: { coin?: { coin: string; walletBalance: string }[] }[] }
}

// Auth-Fehlercodes: 10003 (ungültiger API-Key), 10004 (ungültige Signatur),
// 10005 (Berechtigung fehlt)
const AUTH_CODES = new Set([10003, 10004, 10005])

function classifyBybitError(retCode: number, retMsg: string | undefined): ProviderError {
  const message = `Bybit: ${retMsg ?? `retCode ${retCode}`}`
  if (AUTH_CODES.has(retCode)) return new ProviderError('INVALID_API_KEY', message)
  // 10006 = API-Rate-Limit überschritten
  if (retCode === 10006) return new ProviderError('RATE_LIMITED', message)
  return new ProviderError('PROVIDER_ERROR', message)
}

async function fetchBybitBalances(creds: ExchangeCredentials): Promise<RawBalance[]> {
  if (!creds.apiSecret) throw new ProviderError('INVALID_API_KEY', 'Bybit: API-Secret fehlt')
  const timestamp = Date.now().toString()

  const res = await fetch(`${BASE_URL}${WALLET_PATH}?${QUERY}`, {
    headers: {
      'X-BAPI-API-KEY': creds.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'X-BAPI-SIGN': bybitSignature(timestamp, creds.apiKey, RECV_WINDOW, QUERY, creds.apiSecret),
    },
  })

  if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'Bybit Rate-Limit erreicht')
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('INVALID_API_KEY', `Bybit: HTTP ${res.status}`)
  }
  if (!res.ok) throw new ProviderError('PROVIDER_ERROR', `Bybit antwortet mit ${res.status}`)

  // Bybit antwortet meist mit HTTP 200 — der eigentliche Status steht in retCode
  const json = (await res.json()) as BybitWalletResponse
  if (json.retCode !== 0) throw classifyBybitError(json.retCode, json.retMsg)

  const balances: RawBalance[] = []
  for (const account of json.result?.list ?? []) {
    for (const entry of account.coin ?? []) {
      // walletBalance = Gesamtbestand des Coins im Unified-Konto
      if (Number(entry.walletBalance) > 0) {
        balances.push({ symbol: entry.coin.toUpperCase(), amount: entry.walletBalance })
      }
    }
  }
  return balances
}

export const bybitProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'BYBIT',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // Wallet-Balance ist ein reiner Lese-Endpoint — validiert Key und Secret
    await fetchBybitBalances(creds)
  },

  fetchBalances: fetchBybitBalances,
}
