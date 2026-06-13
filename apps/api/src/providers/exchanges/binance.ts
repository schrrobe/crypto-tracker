import { createHmac } from 'node:crypto'
import {
  ProviderError,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
} from '../provider.types'

// Binance Spot REST API: GET /api/v3/account mit HMAC-SHA256-Signatur (SIGNED).
// Benötigt einen API-Key mit ausschließlich "Enable Reading"-Berechtigung (read-only).

const BASE_URL = 'https://api.binance.com'
const ACCOUNT_PATH = '/api/v3/account'

// Signatur = HMAC-SHA256(queryString ohne signature-Parameter, secret), hex
export function binanceSignature(queryString: string, secret: string): string {
  return createHmac('sha256', secret).update(queryString).digest('hex')
}

// 'LD'-Präfix = Binance Earn / Flexible Savings (z.B. LDBTC → BTC).
// Ausnahme: echte Assets, deren Ticker selbst mit LD beginnt (z.B. LDO = Lido) —
// nach dem Strippen muss ein plausibles Symbol (≥ 2 Zeichen) übrig bleiben.
export function normalizeBinanceAsset(asset: string): string {
  const upper = asset.toUpperCase()
  if (upper.startsWith('LD') && upper.length >= 4) return upper.slice(2)
  return upper
}

// Binance führt auch Fiat-Bestände — Fiat wird in V1 nicht getrackt
const SKIP = new Set(['EUR', 'GBP', 'TRY', 'BRL', 'ARS', 'AUD', 'PLN', 'RON', 'UAH', 'ZAR', 'JPY', 'CZK'])

interface BinanceAccountResponse {
  balances?: { asset: string; free: string; locked: string }[]
}

interface BinanceError {
  code?: number
  msg?: string
}

// Auth-Fehlercodes: -2014 BAD_API_KEY_FMT, -2015 REJECTED_MBX_KEY,
// -1022 INVALID_SIGNATURE, -1002 UNAUTHORIZED
const AUTH_CODES = new Set([-2014, -2015, -1022, -1002])

async function fetchBinanceBalances(creds: ExchangeCredentials): Promise<RawBalance[]> {
  if (!creds.apiSecret) throw new ProviderError('INVALID_API_KEY', 'Binance: API-Secret fehlt')
  const query = `recvWindow=5000&timestamp=${Date.now()}`
  const signature = binanceSignature(query, creds.apiSecret)

  const res = await fetch(`${BASE_URL}${ACCOUNT_PATH}?${query}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': creds.apiKey },
  })

  // 418 = IP-Auto-Ban nach ignorierten 429ern — ebenfalls Rate-Limit
  if (res.status === 429 || res.status === 418) {
    throw new ProviderError('RATE_LIMITED', 'Binance Rate-Limit erreicht')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as BinanceError
    const message = body.msg ?? `HTTP ${res.status}`
    if (res.status === 401 || res.status === 403 || (body.code !== undefined && AUTH_CODES.has(body.code))) {
      throw new ProviderError('INVALID_API_KEY', `Binance: ${message}`)
    }
    if (body.code === -1003) throw new ProviderError('RATE_LIMITED', `Binance: ${message}`)
    throw new ProviderError('PROVIDER_ERROR', `Binance: ${message}`)
  }

  const json = (await res.json()) as BinanceAccountResponse
  const balances: RawBalance[] = []
  for (const entry of json.balances ?? []) {
    const symbol = normalizeBinanceAsset(entry.asset)
    if (SKIP.has(symbol)) continue
    // free und locked als getrennte Einträge — der SyncService summiert
    // gleiche Symbole per Decimal (kein float in der Provider-Schicht)
    for (const amount of [entry.free, entry.locked]) {
      if (Number(amount) > 0) balances.push({ symbol, amount, meta: { binanceAsset: entry.asset } })
    }
  }
  return balances
}

export const binanceProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'BINANCE',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // Account ist ein reiner Lese-Endpoint — validiert Key, Secret und Berechtigung
    await fetchBinanceBalances(creds)
  },

  fetchBalances: fetchBinanceBalances,
}
