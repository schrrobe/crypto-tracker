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

// Binance Spot REST API: GET /api/v3/account with HMAC-SHA256 signature (SIGNED).
// Requires an API key with only the "Enable Reading" permission (read-only).
// Multi-account: Cross-Margin (/sapi/v1/margin/account) + USDⓈ-M-Futures
// (/fapi/v2/account, /fapi/v2/positionRisk). Missing permission on a
// sub-endpoint ⇒ ENDPOINT_FORBIDDEN (skipped, spot continues).

const BASE_URL = 'https://api.binance.com'
const FAPI_URL = 'https://fapi.binance.com'
const ACCOUNT_PATH = '/api/v3/account'

// Signature = HMAC-SHA256(queryString without signature parameter, secret), hex
export function binanceSignature(queryString: string, secret: string): string {
  return createHmac('sha256', secret).update(queryString).digest('hex')
}

// 'LD' prefix = Binance Earn / Flexible Savings (e.g. LDBTC → BTC).
// Exception: real assets whose ticker itself starts with LD (e.g. LDO = Lido) —
// after stripping, a plausible symbol (≥ 2 characters) must remain.
export function normalizeBinanceAsset(asset: string): string {
  const upper = asset.toUpperCase()
  if (upper.startsWith('LD') && upper.length >= 4) return upper.slice(2)
  return upper
}

// Binance also holds fiat balances — fiat is not tracked in V1
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

  // 418 = IP auto-ban after ignored 429s — also a rate limit
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
    // 'LD' prefix = Flexible Savings (Earn) → its own account type, do not fold into Spot
    const accountType = entry.asset.toUpperCase().startsWith('LD') && entry.asset.length >= 4 ? 'EARN' : 'SPOT'
    // free and locked as separate entries — the SyncService sums
    // identical symbols via Decimal (no float in the provider layer)
    for (const amount of [entry.free, entry.locked]) {
      if (Number(amount) > 0) balances.push({ symbol, amount, accountType, meta: { binanceAsset: entry.asset } })
    }
  }
  return balances
}

// Signed GET on sapi/fapi. ENDPOINT_FORBIDDEN if the key has not enabled this
// account type (spot key without margin/futures permission).
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
    // On a sub-endpoint, 401/403/auth-code means: the key lacks this permission
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

// Cross-Margin: netAsset per asset (can be negative = liability)
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

// USDⓈ-M-Futures: wallet collateral (FUTURES balance) + open positions.
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
    // Quote derives from the contract suffix (BTCUSDT → USDT), base is the remainder
    const quote = p.symbol.endsWith('USDC') ? 'USDC' : 'USDT'
    const base = p.symbol.slice(0, -quote.length)
    positions.push({
      rawSymbol: p.symbol,
      baseSymbol: base,
      side: amt > 0 ? 'LONG' : 'SHORT',
      // Sign via Number, but size as a string (no float precision loss)
      size: p.positionAmt.replace(/^-/, ''),
      entryPrice: p.entryPrice,
      markPrice: p.markPrice,
      leverage: Number(p.leverage) || undefined,
      unrealizedPnl: p.unRealizedProfit,
      quoteCurrency: quote,
      // Binance returns "0" for positions without a liquidation price → do not show as 0
      liquidationPrice: Number(p.liquidationPrice) > 0 ? p.liquidationPrice : undefined,
    })
  }
  return { balances, positions }
}

export const binanceProvider: ExchangeProvider = {
  kind: 'exchange',
  id: 'BINANCE',

  async validateCredentials(creds: ExchangeCredentials): Promise<void> {
    // Account is a pure read endpoint — validates key, secret and permission
    await fetchBinanceBalances(creds)
  },

  fetchBalances: fetchBinanceBalances,

  async fetchAccount(creds: ExchangeCredentials): Promise<ExchangeAccountSnapshot> {
    const warnings: string[] = []
    const balances = await fetchBinanceBalances(creds) // Spot+Earn (mandatory)
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
