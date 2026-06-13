import { env } from '../config/env'
import { AppError } from '../lib/errors'

const BASE = 'https://api.coingecko.com/api/v3'

export type SimplePrices = Record<string, { eur?: number; usd?: number }>

// Deterministische Preise für Tests/lokale Entwicklung ohne echte API
const FAKE_PRICES: Record<string, { eur: number; usd: number }> = {
  bitcoin: { eur: 50_000, usd: 55_000 },
  ethereum: { eur: 2_000, usd: 2_200 },
  solana: { eur: 100, usd: 110 },
  tether: { eur: 0.9, usd: 1 },
  'usd-coin': { eur: 0.9, usd: 1 },
  // für E2E-Tests des manuellen Asset-Mappings
  fookoin: { eur: 2, usd: 2.2 },
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface CoinSearchResult {
  id: string
  symbol: string
  name: string
}

// Coin-Suche für das manuelle Asset-Mapping (proxied, damit das Frontend nie
// direkt mit CoinGecko spricht)
export async function searchCoins(query: string): Promise<CoinSearchResult[]> {
  if (env.FAKE_PRICES) {
    // Echo-Fake: jede Suche liefert genau einen Treffer mit deterministischer ID —
    // Tests können so beliebige (eindeutige) Symbole mappen, Preis = Fake-Default
    const q = query.toLowerCase().trim()
    if (!q) return []
    return [{ id: `${q}-coin`, symbol: q, name: `${q.toUpperCase()} Coin` }]
  }

  const res = await fetch(`${BASE}/search?query=${encodeURIComponent(query)}`, {
    headers: env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {},
  })
  if (!res.ok) {
    throw new AppError('PRICE_PROVIDER_ERROR', 502, `CoinGecko antwortet mit ${res.status}`)
  }
  const json = (await res.json()) as { coins?: Array<{ id: string; symbol: string; name: string }> }
  return (json.coins ?? []).slice(0, 10).map((c) => ({ id: c.id, symbol: c.symbol, name: c.name }))
}

// [timestampMs, price] — wie von CoinGecko market_chart geliefert
export type MarketChartPoint = [number, number]

const chartCache = new Map<string, { at: number; data: MarketChartPoint[] }>()
const CHART_CACHE_TTL_MS = 30 * 60 * 1000

// Historische Preise für den Wertverlauf — on-demand statt lokaler Snapshots,
// damit das Chart auch ohne Background-Sync sofort gefüllt ist. 30-min-Cache
// pro Asset/Währung/Zeitraum schont das CoinGecko-Rate-Limit.
export async function fetchMarketChart(
  coingeckoId: string,
  currency: 'eur' | 'usd',
  days: 1 | 7 | 30,
): Promise<MarketChartPoint[]> {
  const cacheKey = `${coingeckoId}:${currency}:${days}`
  const cached = chartCache.get(cacheKey)
  if (cached && cached.at > Date.now() - CHART_CACHE_TTL_MS) return cached.data

  let data: MarketChartPoint[]
  if (env.FAKE_PRICES) {
    // Deterministisch: linear von 90 % auf 100 % des Fake-Preises, Endpunkt = jetzt
    const current = (FAKE_PRICES[coingeckoId] ?? { eur: 1, usd: 1.1 })[currency]
    const points = 24
    const now = Date.now()
    const span = days * 24 * 60 * 60 * 1000
    data = Array.from({ length: points + 1 }, (_, i) => {
      const fraction = i / points
      return [now - span + span * fraction, current * (0.9 + 0.1 * fraction)] as MarketChartPoint
    })
  } else {
    const url = `${BASE}/coins/${encodeURIComponent(coingeckoId)}/market_chart?vs_currency=${currency}&days=${days}`
    const res = await fetch(url, {
      headers: env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {},
    })
    if (!res.ok) {
      throw new AppError('PRICE_PROVIDER_ERROR', 502, `CoinGecko antwortet mit ${res.status}`)
    }
    data = ((await res.json()) as { prices?: MarketChartPoint[] }).prices ?? []
  }

  chartCache.set(cacheKey, { at: Date.now(), data })
  return data
}

// EUR-Tagespreis (00:00 UTC) für die Steuer-Kostenbasis. null = CoinGecko hat
// keinen Preis für dieses Datum (Free Tier: max. ~365 Tage zurück, antwortet
// dann mit 401) — der Aufrufer cached das als Negativ-Eintrag.
export async function fetchHistoricalPrice(coingeckoId: string, date: Date): Promise<number | null> {
  if (env.FAKE_PRICES) {
    // Deterministisch datumsabhängig: 80–100 % des Fake-Preises über das Jahr
    const base = (FAKE_PRICES[coingeckoId] ?? { eur: 1, usd: 1.1 }).eur
    const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1)
    const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000)
    return base * (0.8 + 0.2 * (dayOfYear / 366))
  }

  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = date.getUTCFullYear()
  const url = `${BASE}/coins/${encodeURIComponent(coingeckoId)}/history?date=${dd}-${mm}-${yyyy}&localization=false`
  const res = await fetch(url, {
    headers: env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {},
  })
  // 401: Datum außerhalb des Free-Tier-Fensters; 404: Coin unbekannt — beides „kein Preis"
  if (res.status === 401 || res.status === 404) return null
  if (!res.ok) {
    throw new AppError('PRICE_PROVIDER_ERROR', 502, `CoinGecko antwortet mit ${res.status}`)
  }
  const json = (await res.json()) as { market_data?: { current_price?: { eur?: number } } }
  return json.market_data?.current_price?.eur ?? null
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
    const res = await fetch(url, {
      headers: env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {},
    })
    if (!res.ok) {
      throw new AppError('PRICE_PROVIDER_ERROR', 502, `CoinGecko antwortet mit ${res.status}`)
    }
    Object.assign(result, (await res.json()) as SimplePrices)
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

// Top 100 nach Market Cap inkl. 24h-Änderung — reine Anzeige-Daten (number ok,
// keine Geld-Pipeline). 60-s-Cache pro Währung.
export async function fetchMarkets(currency: 'eur' | 'usd'): Promise<MarketCoin[]> {
  const cached = marketsCache.get(currency)
  if (cached && cached.at > Date.now() - MARKETS_CACHE_TTL_MS) return cached.data

  let data: MarketCoin[]
  if (env.FAKE_PRICES) {
    // Deterministisch: 100 Coins, Preis/Cap aus dem Rang ableitbar; jeder dritte
    // Eintrag negativ (für die Verlierer-Liste)
    data = Array.from({ length: 100 }, (_, i) => {
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
  } else {
    const url =
      `${BASE}/coins/markets?vs_currency=${currency}` +
      '&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h'
    const res = await fetch(url, {
      headers: env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {},
    })
    if (!res.ok) {
      throw new AppError('PRICE_PROVIDER_ERROR', 502, `CoinGecko antwortet mit ${res.status}`)
    }
    const json = (await res.json()) as Array<{
      id: string
      symbol: string
      name: string
      image?: string
      current_price: number
      market_cap: number
      market_cap_rank: number
      price_change_percentage_24h: number | null
    }>
    data = json.map((c) => ({
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

  marketsCache.set(currency, { at: Date.now(), data })
  return data
}
