import { createHmac } from 'node:crypto'
import {
  ProviderError,
  type ExchangeAccountSnapshot,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
  type RawPosition,
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

interface BybitPosition {
  symbol: string
  side: string // "Buy" | "Sell"
  size: string
  avgPrice?: string
  markPrice?: string
  leverage?: string
  unrealisedPnl?: string
  liqPrice?: string
}
interface BybitPositionResponse {
  retCode: number
  retMsg?: string
  result?: { list?: BybitPosition[] }
}

export function parseBybitPositions(list: BybitPosition[]): RawPosition[] {
  const positions: RawPosition[] = []
  for (const p of list) {
    if (Number(p.size) === 0) continue
    // Linear-Contracts sind USDT-/USDC-besichert (z.B. BTCUSDT)
    const quote = p.symbol.endsWith('USDC') ? 'USDC' : 'USDT'
    positions.push({
      rawSymbol: p.symbol,
      baseSymbol: p.symbol.slice(0, -quote.length),
      side: p.side === 'Sell' ? 'SHORT' : 'LONG',
      size: p.size,
      entryPrice: p.avgPrice,
      markPrice: p.markPrice,
      leverage: p.leverage ? Number(p.leverage) : undefined,
      unrealizedPnl: p.unrealisedPnl,
      quoteCurrency: quote,
      liquidationPrice: p.liqPrice,
    })
  }
  return positions
}

const POSITION_QUERY = 'category=linear&settleCoin=USDT'

export async function fetchBybitPositions(creds: ExchangeCredentials): Promise<RawPosition[]> {
  const timestamp = Date.now().toString()
  const res = await fetch(`${BASE_URL}/v5/position/list?${POSITION_QUERY}`, {
    headers: {
      'X-BAPI-API-KEY': creds.apiKey,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
      'X-BAPI-SIGN': bybitSignature(timestamp, creds.apiKey, RECV_WINDOW, POSITION_QUERY, creds.apiSecret as string),
    },
  })
  if (res.status === 429) throw new ProviderError('RATE_LIMITED', 'Bybit Rate-Limit erreicht')
  if (res.status === 401 || res.status === 403) throw new ProviderError('ENDPOINT_FORBIDDEN', `Bybit: HTTP ${res.status}`)
  const json = (await res.json().catch(() => null)) as BybitPositionResponse | null
  if (!json || json.retCode !== 0) {
    if (json && AUTH_CODES.has(json.retCode)) throw new ProviderError('ENDPOINT_FORBIDDEN', `Bybit: ${json.retMsg}`)
    throw new ProviderError('PROVIDER_ERROR', `Bybit: ${json?.retMsg ?? `HTTP ${res.status}`}`)
  }
  return parseBybitPositions(json.result?.list ?? [])
}

export const bybitProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'BYBIT',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // Wallet-Balance ist ein reiner Lese-Endpoint — validiert Key und Secret
    await fetchBybitBalances(creds)
  },

  fetchBalances: fetchBybitBalances,

  // Unified-Account: Spot/Margin im walletBalance enthalten → zusätzlich nur
  // offene Linear-Positionen. Fehlt das Recht ⇒ Warnung, Spot läuft weiter.
  async fetchAccount(creds: ExchangeCredentials): Promise<ExchangeAccountSnapshot> {
    const warnings: string[] = []
    const balances = await fetchBybitBalances(creds)
    let positions: RawPosition[] = []
    try {
      positions = await fetchBybitPositions(creds)
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'ENDPOINT_FORBIDDEN') {
        warnings.push(`Bybit Positionen: ${err.message}`)
      } else throw err
    }
    return { balances, positions, warnings }
  },
}
