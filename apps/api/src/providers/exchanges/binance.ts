import { createHmac } from 'node:crypto'
import {
  ProviderError,
  type ExchangeAccountSnapshot,
  type ExchangeCredentials,
  type ExchangeProvider,
  type RawBalance,
  type RawPosition,
} from '../provider.types'
import { safeSubFetch } from './account-snapshot'

// Binance Spot REST API: GET /api/v3/account mit HMAC-SHA256-Signatur (SIGNED).
// Benötigt einen API-Key mit ausschließlich "Enable Reading"-Berechtigung (read-only).
// Multi-Konto: Cross-Margin (/sapi/v1/margin/account) + USDⓈ-M-Futures
// (/fapi/v2/account, /fapi/v2/positionRisk). Fehlende Berechtigung auf einem
// Subendpoint ⇒ ENDPOINT_FORBIDDEN (übersprungen, Spot läuft weiter).

const BASE_URL = 'https://api.binance.com'
const FAPI_URL = 'https://fapi.binance.com'
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
    // 'LD'-Präfix = Flexible Savings (Earn) → eigener Kontotyp, nicht in Spot falten
    const accountType = entry.asset.toUpperCase().startsWith('LD') && entry.asset.length >= 4 ? 'EARN' : 'SPOT'
    // free und locked als getrennte Einträge — der SyncService summiert
    // gleiche Symbole per Decimal (kein float in der Provider-Schicht)
    for (const amount of [entry.free, entry.locked]) {
      if (Number(amount) > 0) balances.push({ symbol, amount, accountType, meta: { binanceAsset: entry.asset } })
    }
  }
  return balances
}

// Signierter GET auf sapi/fapi. ENDPOINT_FORBIDDEN, wenn der Key diesen
// Kontotyp nicht freigeschaltet hat (Spot-Key ohne Margin/Futures-Recht).
async function signedGet<T>(baseUrl: string, path: string, creds: ExchangeCredentials): Promise<T> {
  if (!creds.apiSecret) throw new ProviderError('INVALID_API_KEY', 'Binance: API-Secret fehlt')
  const query = `recvWindow=5000&timestamp=${Date.now()}`
  const signature = binanceSignature(query, creds.apiSecret)
  const res = await fetch(`${baseUrl}${path}?${query}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': creds.apiKey },
  })
  if (res.status === 429 || res.status === 418) throw new ProviderError('RATE_LIMITED', 'Binance Rate-Limit erreicht')
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as BinanceError
    const message = body.msg ?? `HTTP ${res.status}`
    // Auf einem Subendpoint heißt 401/403/Auth-Code: Key hat diese Berechtigung nicht
    if (res.status === 401 || res.status === 403 || (body.code !== undefined && AUTH_CODES.has(body.code))) {
      throw new ProviderError('ENDPOINT_FORBIDDEN', `Binance: ${message}`)
    }
    if (body.code === -1003) throw new ProviderError('RATE_LIMITED', `Binance: ${message}`)
    throw new ProviderError('PROVIDER_ERROR', `Binance: ${message}`)
  }
  return (await res.json()) as T
}

interface BinanceMarginResponse {
  userAssets?: { asset: string; netAsset: string }[]
}

// Cross-Margin: netAsset je Asset (kann negativ sein = Verbindlichkeit)
export async function fetchBinanceMargin(creds: ExchangeCredentials): Promise<RawBalance[]> {
  const json = await signedGet<BinanceMarginResponse>(BASE_URL, '/sapi/v1/margin/account', creds)
  const balances: RawBalance[] = []
  for (const a of json.userAssets ?? []) {
    const symbol = a.asset.toUpperCase()
    if (SKIP.has(symbol)) continue
    if (Number(a.netAsset) !== 0) balances.push({ symbol, amount: a.netAsset, accountType: 'MARGIN' })
  }
  return balances
}

interface BinanceFuturesAccount {
  assets?: { asset: string; walletBalance: string }[]
}
interface BinanceFuturesPositionRisk {
  symbol: string
  positionAmt: string
  entryPrice: string
  markPrice: string
  leverage: string
  unRealizedProfit: string
  liquidationPrice: string
}

// USDⓈ-M-Futures: Wallet-Collateral (FUTURES-Bestand) + offene Positionen.
export async function fetchBinanceFutures(
  creds: ExchangeCredentials,
): Promise<{ balances: RawBalance[]; positions: RawPosition[] }> {
  const account = await signedGet<BinanceFuturesAccount>(FAPI_URL, '/fapi/v2/account', creds)
  const balances: RawBalance[] = []
  for (const a of account.assets ?? []) {
    const symbol = a.asset.toUpperCase()
    if (SKIP.has(symbol)) continue
    if (Number(a.walletBalance) !== 0) balances.push({ symbol, amount: a.walletBalance, accountType: 'FUTURES' })
  }
  const risk = await signedGet<BinanceFuturesPositionRisk[]>(FAPI_URL, '/fapi/v2/positionRisk', creds)
  const positions: RawPosition[] = []
  for (const p of risk) {
    const amt = Number(p.positionAmt)
    if (amt === 0) continue
    // Quote ergibt sich aus dem Contract-Suffix (BTCUSDT → USDT), Basis ist der Rest
    const quote = p.symbol.endsWith('USDC') ? 'USDC' : 'USDT'
    const base = p.symbol.slice(0, -quote.length)
    positions.push({
      rawSymbol: p.symbol,
      baseSymbol: base,
      side: amt > 0 ? 'LONG' : 'SHORT',
      // Vorzeichen über Number, Größe aber als String (keine float-Präzisionsverluste)
      size: p.positionAmt.replace(/^-/, ''),
      entryPrice: p.entryPrice,
      markPrice: p.markPrice,
      leverage: Number(p.leverage) || undefined,
      unrealizedPnl: p.unRealizedProfit,
      quoteCurrency: quote,
      // Binance liefert "0" für Positionen ohne Liquidationspreis → nicht als 0 anzeigen
      liquidationPrice: Number(p.liquidationPrice) > 0 ? p.liquidationPrice : undefined,
    })
  }
  return { balances, positions }
}

export const binanceProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'BINANCE',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // Account ist ein reiner Lese-Endpoint — validiert Key, Secret und Berechtigung
    await fetchBinanceBalances(creds)
  },

  fetchBalances: fetchBinanceBalances,

  async fetchAccount(creds: ExchangeCredentials): Promise<ExchangeAccountSnapshot> {
    const warnings: string[] = []
    const balances = await fetchBinanceBalances(creds) // Spot+Earn (pflicht)
    balances.push(...(await safeSubFetch(() => fetchBinanceMargin(creds), 'Binance Margin', warnings)))
    let positions: RawPosition[] = []
    try {
      const fut = await fetchBinanceFutures(creds)
      balances.push(...fut.balances)
      positions = fut.positions
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'ENDPOINT_FORBIDDEN') {
        warnings.push(`Binance Futures: ${err.message}`)
      } else throw err
    }
    return { balances, positions, warnings }
  },
}
