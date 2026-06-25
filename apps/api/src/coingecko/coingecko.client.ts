import { env } from '../config/env'
import { AppError } from '../lib/errors'

const BASE = 'https://api.coingecko.com/api/v3'

// Central CoinGecko fetch: sets the demo-key header, maps errors to a clean 502,
// and parses JSON defensively. On rate limits CoinGecko sometimes returns 200 with
// HTML/text instead of JSON — without this guard res.json() would throw an
// unhandled exception (500).
//   notFoundCodes: HTTP codes that count as "no match" and return null
//   (instead of 502) — e.g. 404 on the historical daily price.
//   windowOutCodes: HTTP codes that mean "not available to THIS API tier"
//   (e.g. 401 = date outside the free-tier window) — thrown as a typed
//   PRICE_OUT_OF_WINDOW so the caller can avoid caching it as a permanent
//   negative (a paid key may unlock the date later).
async function cgFetchJson<T>(
  url: string,
  notFoundCodes: number[] = [],
  windowOutCodes: number[] = [],
): Promise<T | null> {
  const res = await fetch(url, {
    headers: env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {},
  })
  if (notFoundCodes.includes(res.status)) return null
  if (windowOutCodes.includes(res.status)) {
    throw new AppError(
      'PRICE_OUT_OF_WINDOW',
      502,
      `CoinGecko: Datum außerhalb des Abruf-Fensters (${res.status})`,
    )
  }
  if (!res.ok) {
    throw new AppError('PRICE_PROVIDER_ERROR', 502, `CoinGecko antwortet mit ${res.status}`)
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new AppError('PRICE_PROVIDER_ERROR', 502, 'CoinGecko lieferte keine gültige JSON-Antwort')
  }
}

export type SimplePrices = Record<string, { eur?: number; usd?: number }>

// Deterministic prices for tests/local development without a real API
const FAKE_PRICES: Record<string, { eur: number; usd: number }> = {
  bitcoin: { eur: 50_000, usd: 55_000 },
  ethereum: { eur: 2_000, usd: 2_200 },
  solana: { eur: 100, usd: 110 },
  tether: { eur: 0.9, usd: 1 },
  'usd-coin': { eur: 0.9, usd: 1 },
  // for E2E tests of the manual asset mapping
  fookoin: { eur: 2, usd: 2.2 },
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Insert into a size-bounded cache: Map keeps insertion order, so evicting the
// first key drops the oldest entry. Stops the in-memory caches from growing
// without bound across the coin × currency × range key space.
function cacheSet<V>(cache: Map<string, V>, key: string, value: V, max: number): void {
  if (!cache.has(key) && cache.size >= max) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

export interface CoinSearchResult {
  id: string
  symbol: string
  name: string
}

// Coin search for the manual asset mapping (proxied so the frontend never
// talks to CoinGecko directly)
export async function searchCoins(query: string): Promise<CoinSearchResult[]> {
  if (env.FAKE_PRICES) {
    // Echo fake: every search returns exactly one match with a deterministic ID —
    // this lets tests map arbitrary (unique) symbols, price = fake default
    const q = query.toLowerCase().trim()
    if (!q) return []
    return [{ id: `${q}-coin`, symbol: q, name: `${q.toUpperCase()} Coin` }]
  }

  const json = await cgFetchJson<{ coins?: Array<{ id: string; symbol: string; name: string }> }>(
    `${BASE}/search?query=${encodeURIComponent(query)}`,
  )
  return (json?.coins ?? []).slice(0, 10).map((c) => ({ id: c.id, symbol: c.symbol, name: c.name }))
}

// [timestampMs, price] — as delivered by CoinGecko market_chart
export type MarketChartPoint = [number, number]

const chartCache = new Map<string, { at: number; data: MarketChartPoint[] }>()
const CHART_CACHE_TTL_MS = 30 * 60 * 1000
const CHART_CACHE_MAX = 500

// Historical prices for the value history — on-demand instead of local snapshots,
// so the chart is filled immediately even without background sync. A 30-min cache
// per asset/currency/range spares the CoinGecko rate limit.
export async function fetchMarketChart(
  coingeckoId: string,
  currency: 'eur' | 'usd',
  days: 1 | 7 | 30 | 365,
): Promise<MarketChartPoint[]> {
  const cacheKey = `${coingeckoId}:${currency}:${days}`
  const cached = chartCache.get(cacheKey)
  if (cached && cached.at > Date.now() - CHART_CACHE_TTL_MS) return cached.data

  if (env.FAKE_PRICES) {
    // Deterministic: linear from 90 % to 100 % of the fake price, endpoint = now
    const current = (FAKE_PRICES[coingeckoId] ?? { eur: 1, usd: 1.1 })[currency]
    const points = 24
    const now = Date.now()
    const span = days * 24 * 60 * 60 * 1000
    const data = Array.from({ length: points + 1 }, (_, i) => {
      const fraction = i / points
      return [now - span + span * fraction, current * (0.9 + 0.1 * fraction)] as MarketChartPoint
    })
    cacheSet(chartCache, cacheKey, { at: Date.now(), data }, CHART_CACHE_MAX)
    return data
  }

  const url = `${BASE}/coins/${encodeURIComponent(coingeckoId)}/market_chart?vs_currency=${currency}&days=${days}`
  try {
    const json = await cgFetchJson<{ prices?: MarketChartPoint[] }>(url)
    const data = json?.prices ?? []
    cacheSet(chartCache, cacheKey, { at: Date.now(), data }, CHART_CACHE_MAX)
    return data
  } catch (err) {
    // Rate limit/outage: return the last known state (no matter how old) instead
    // of letting the whole history fail. Without a cache the error is propagated.
    if (cached) {
      console.warn(`[coingecko] market_chart fehlgeschlagen, liefere Cache-Stand: ${String(err)}`)
      return cached.data
    }
    throw err
  }
}

// Result of a historical daily-price lookup. The three states must stay
// distinct so the cache is not poisoned:
//   ok            → a price exists, cache it
//   no-data       → coin/date genuinely has no price (404 or empty body) →
//                   cache as a permanent negative (re-asking will not help)
//   out-of-window → date is outside THIS tier's window (401) → DO NOT cache;
//                   a paid key would return a price, so a later run must retry
export type HistoricalPriceLookup =
  | { status: 'ok'; priceEur: number }
  | { status: 'no-data' }
  | { status: 'out-of-window' }

// EUR daily price (00:00 UTC) for the tax cost basis.
export async function fetchHistoricalPrice(
  coingeckoId: string,
  date: Date,
): Promise<HistoricalPriceLookup> {
  if (env.FAKE_PRICES) {
    // Deterministic and date-dependent: 80–100 % of the fake price across the year
    const base = (FAKE_PRICES[coingeckoId] ?? { eur: 1, usd: 1.1 }).eur
    const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1)
    const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000)
    return { status: 'ok', priceEur: base * (0.8 + 0.2 * (dayOfYear / 366)) }
  }

  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = date.getUTCFullYear()
  const url = `${BASE}/coins/${encodeURIComponent(coingeckoId)}/history?date=${dd}-${mm}-${yyyy}&localization=false`
  try {
    // 404 → coin unknown ("no price", cacheable). 401 → date outside the
    // free-tier window (tier-dependent, NOT cacheable) → thrown + caught below.
    const json = await cgFetchJson<{ market_data?: { current_price?: { eur?: number } } }>(
      url,
      [404],
      [401],
    )
    const eur = json?.market_data?.current_price?.eur
    return eur === undefined || eur === null ? { status: 'no-data' } : { status: 'ok', priceEur: eur }
  } catch (err) {
    if (err instanceof AppError && err.code === 'PRICE_OUT_OF_WINDOW') {
      return { status: 'out-of-window' }
    }
    throw err
  }
}

export async function fetchSimplePrices(coingeckoIds: string[]): Promise<SimplePrices> {
  if (coingeckoIds.length === 0) return {}

  if (env.FAKE_PRICES) {
    return Object.fromEntries(
      coingeckoIds.map((id) => [id, FAKE_PRICES[id] ?? { eur: 1, usd: 1.1 }]),
    )
  }

  const result: SimplePrices = {}
  for (const batch of chunk(coingeckoIds, 250)) {
    const url = `${BASE}/simple/price?ids=${batch.join(',')}&vs_currencies=eur,usd`
    Object.assign(result, (await cgFetchJson<SimplePrices>(url)) ?? {})
  }
  return result
}

export interface MarketCoin {
  id: string
  symbol: string
  name: string
  iconUrl: string | null
  price: number
  marketCap: number
  rank: number
  change24hPct: number | null
}

const marketsCache = new Map<string, { at: number; data: MarketCoin[] }>()
const MARKETS_CACHE_TTL_MS = 60_000

// Top 100 by market cap incl. 24h change — pure display data (number is fine,
// not the money pipeline). 60-s cache per currency.
export async function fetchMarkets(currency: 'eur' | 'usd'): Promise<MarketCoin[]> {
  const cached = marketsCache.get(currency)
  if (cached && cached.at > Date.now() - MARKETS_CACHE_TTL_MS) return cached.data

  if (env.FAKE_PRICES) {
    // Deterministic: 100 coins, price/cap derivable from the rank; every third
    // entry negative (for the losers list)
    const data = Array.from({ length: 100 }, (_, i) => {
      const rank = i + 1
      return {
        id: `fake-coin-${rank}`,
        symbol: `C${rank}`,
        name: `Fake Coin ${rank}`,
        iconUrl: null,
        price: 10_000 / rank,
        marketCap: 1_000_000_000 / rank,
        rank,
        change24hPct: (rank % 3 === 0 ? -1 : 1) * (rank % 10),
      }
    })
    marketsCache.set(currency, { at: Date.now(), data })
    return data
  }

  try {
    const data = await fetchMarketsFromCoinGecko(currency)
    marketsCache.set(currency, { at: Date.now(), data })
    return data
  } catch (err) {
    // CoinGecko free tier (without a key) is often rate-limited (429). Instead of
    // dropping the whole market tab: return the last known state, no matter how old.
    // Only without any cache is the error propagated.
    if (cached) {
      console.warn(`[coingecko] Markt-Abruf fehlgeschlagen, liefere Cache-Stand: ${String(err)}`)
      return cached.data
    }
    throw err
  }
}

async function fetchMarketsFromCoinGecko(currency: 'eur' | 'usd'): Promise<MarketCoin[]> {
  const url =
    `${BASE}/coins/markets?vs_currency=${currency}` +
    '&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h'
  const json = await cgFetchJson<
    Array<{
      id: string
      symbol: string
      name: string
      image?: string
      current_price: number
      market_cap: number
      market_cap_rank: number
      price_change_percentage_24h: number | null
    }>
  >(url)
  if (!Array.isArray(json)) {
    throw new AppError('PRICE_PROVIDER_ERROR', 502, 'CoinGecko lieferte ein unerwartetes Format')
  }
  return json.map((c) => ({
    id: c.id,
    symbol: c.symbol.toUpperCase(),
    name: c.name,
    iconUrl: c.image ?? null,
    price: c.current_price,
    marketCap: c.market_cap,
    rank: c.market_cap_rank,
    change24hPct: c.price_change_percentage_24h,
  }))
}
