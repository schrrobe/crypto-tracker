import { Prisma } from '@prisma/client'
import type {
  AccountTypeBreakdown,
  HistoryRange,
  HoldingAccountType,
  PortfolioAssetPosition,
  PortfolioHistoryDto,
  PortfolioSummaryDto,
  AssetDto,
} from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { getLatestPrices, refreshPrices } from '../../coingecko/price.service'
import { fetchMarketChart, type MarketChartPoint } from '../../coingecko/coingecko.client'
import { resolvePortfolioId } from '../portfolios/portfolios.service'

const ZERO = new Prisma.Decimal(0)

export async function getSummary(userId: string, portfolioId?: string): Promise<PortfolioSummaryDto> {
  const pid = await resolvePortfolioId(userId, portfolioId)
  const holdings = await prisma.holding.findMany({
    where: { source: { userId, portfolioId: pid } },
    include: { asset: true },
  })

  const assetIds = [...new Set(holdings.map((h) => h.assetId))]
  const prices = await getLatestPrices(assetIds)

  // Aggregate across all sources per asset
  const byAssetMap = new Map<string, { asset: AssetDto; quantity: Prisma.Decimal }>()
  for (const h of holdings) {
    const entry = byAssetMap.get(h.assetId)
    if (entry) {
      entry.quantity = entry.quantity.add(h.quantity)
    } else {
      byAssetMap.set(h.assetId, {
        asset: {
          id: h.asset.id,
          symbol: h.asset.symbol,
          name: h.asset.name,
          coingeckoId: h.asset.coingeckoId,
          iconUrl: h.asset.iconUrl,
        },
        quantity: h.quantity,
      })
    }
  }

  let totalEur = ZERO
  let totalUsd = ZERO
  let pricesFetchedAt: Date | null = null
  const byAsset: PortfolioAssetPosition[] = []
  const unmappedAssets: AssetDto[] = []

  for (const { asset, quantity } of byAssetMap.values()) {
    const price = prices.get(asset.id)
    let valueEur: string | null = null
    let valueUsd: string | null = null
    if (price) {
      const eur = quantity.mul(price.priceEur)
      const usd = quantity.mul(price.priceUsd)
      totalEur = totalEur.add(eur)
      totalUsd = totalUsd.add(usd)
      valueEur = eur.toFixed(2)
      valueUsd = usd.toFixed(2)
      if (!pricesFetchedAt || price.fetchedAt < pricesFetchedAt) pricesFetchedAt = price.fetchedAt
    } else if (asset.coingeckoId === null) {
      // Only a genuinely unmapped asset (no CoinGecko id) belongs in unmappedAssets —
      // that list drives the "needs mapping" UI. A MAPPED asset whose price is only
      // momentarily missing (e.g. a partial CoinGecko response) must NOT be relabelled
      // as unmapped; it stays in byAsset with a null value until the next refresh.
      unmappedAssets.push(asset)
    }
    byAsset.push({ asset, quantity: quantity.toString(), valueEur, valueUsd })
  }

  // Largest position first
  byAsset.sort((a, b) => Number(b.valueEur ?? 0) - Number(a.valueEur ?? 0))

  // Signed breakdown per account type (MARGIN may be negative)
  const accTotals = new Map<HoldingAccountType, { eur: Prisma.Decimal; usd: Prisma.Decimal }>()
  for (const h of holdings) {
    const price = prices.get(h.assetId)
    if (!price) continue
    const prev = accTotals.get(h.accountType) ?? { eur: ZERO, usd: ZERO }
    accTotals.set(h.accountType, {
      eur: prev.eur.add(h.quantity.mul(price.priceEur)),
      usd: prev.usd.add(h.quantity.mul(price.priceUsd)),
    })
  }
  const byAccountType: AccountTypeBreakdown[] = [...accTotals.entries()].map(([accountType, v]) => ({
    accountType,
    valueEur: v.eur.toFixed(2),
    valueUsd: v.usd.toFixed(2),
  }))

  // Futures uPnL separately (NOT in totalEur — collateral is already part of the holdings)
  const { eur: futuresUnrealizedPnlEur, usd: futuresUnrealizedPnlUsd } = await futuresUpnl(userId, pid)

  return {
    totalEur: totalEur.toFixed(2),
    totalUsd: totalUsd.toFixed(2),
    pricesFetchedAt: pricesFetchedAt?.toISOString() ?? null,
    byAsset,
    byAccountType,
    futuresUnrealizedPnlEur,
    futuresUnrealizedPnlUsd,
    unmappedAssets,
  }
}

// Sum of the unrealized futures PnL (in quoteCurrency ≈ USD) → EUR/USD via
// the stablecoin price (tether). Null when there are no positions or no price.
async function futuresUpnl(
  userId: string,
  portfolioId: string,
): Promise<{ eur: string | null; usd: string | null }> {
  const positions = await prisma.futuresPosition.findMany({
    where: { source: { userId, portfolioId }, unrealizedPnl: { not: null } },
    select: { unrealizedPnl: true },
  })
  if (positions.length === 0) return { eur: null, usd: null }
  const usdt = await prisma.asset.findUnique({ where: { coingeckoId: 'tether' } })
  const price = usdt ? (await getLatestPrices([usdt.id])).get(usdt.id) : undefined
  if (!price) return { eur: null, usd: null }
  let sum = ZERO
  for (const p of positions) sum = sum.add(p.unrealizedPnl ?? ZERO)
  return { eur: sum.mul(price.priceEur).toFixed(2), usd: sum.mul(price.priceUsd).toFixed(2) }
}

const RANGE_CONFIG: Record<HistoryRange, { days: 1 | 7 | 30 | 365; buckets: number }> = {
  '24h': { days: 1, buckets: 24 },
  '7d': { days: 7, buckets: 28 },
  '30d': { days: 30, buckets: 30 },
  '1y': { days: 365, buckets: 52 },
}

// Limited number of assets per history: 1 market_chart call per asset/currency —
// top-N by current value covers practically the entire portfolio.
const HISTORY_MAX_ASSETS = 10

// Last known price ≤ bucket timestamp (series of different coins have
// slightly offset timestamps)
function priceAt(series: MarketChartPoint[], timestampMs: number): number | null {
  let result: number | null = null
  for (const [t, price] of series) {
    if (t > timestampMs) break
    result = price
  }
  return result ?? (series[0] ? series[0][1] : null)
}

// Value history of the CURRENT holdings at historical prices — deliberately no
// holdings history (past buys/sells are not back-calculated).
export async function getHistory(
  userId: string,
  range: HistoryRange,
  currency: 'EUR' | 'USD',
  portfolioId?: string,
): Promise<PortfolioHistoryDto> {
  const { days, buckets } = RANGE_CONFIG[range]
  const pid = await resolvePortfolioId(userId, portfolioId)

  const holdings = await prisma.holding.findMany({
    where: { source: { userId, portfolioId: pid } },
    include: { asset: { select: { coingeckoId: true } } },
  })

  // aggregate per asset; only mapped assets have a price history.
  // Count unmapped by DISTINCT asset, not per holding (same coin can sit in
  // several sources and would otherwise be counted multiple times).
  const byCoin = new Map<string, Prisma.Decimal>()
  const unmappedAssetIds = new Set<string>()
  for (const h of holdings) {
    const coinId = h.asset.coingeckoId
    if (!coinId) {
      unmappedAssetIds.add(h.assetId)
      continue
    }
    byCoin.set(coinId, (byCoin.get(coinId) ?? ZERO).add(h.quantity))
  }
  let excludedAssets = unmappedAssetIds.size

  if (byCoin.size === 0) return { range, currency, points: [], excludedAssets }

  // Top-N by current value
  const prices = await getLatestPrices(holdings.map((h) => h.assetId))
  const currentValue = new Map<string, number>()
  for (const h of holdings) {
    const coinId = h.asset.coingeckoId
    const price = prices.get(h.assetId)
    if (!coinId || !price) continue
    const value = Number(h.quantity.mul(currency === 'EUR' ? price.priceEur : price.priceUsd))
    currentValue.set(coinId, (currentValue.get(coinId) ?? 0) + value)
  }
  // Sort by current value desc; coins whose latest price is momentarily missing
  // rank as 0. Stable tie-break by coinId keeps selection deterministic so a
  // dropped coin (and the excludedAssets count below) does not flicker between
  // requests. Anything beyond the top-N is surfaced via excludedAssets.
  const topCoins = [...byCoin.keys()]
    .sort((a, b) => (currentValue.get(b) ?? 0) - (currentValue.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, HISTORY_MAX_ASSETS)
  excludedAssets += byCoin.size - topCoins.length

  const vsCurrency = currency.toLowerCase() as 'eur' | 'usd'
  const series = new Map<string, MarketChartPoint[]>()
  // Sequential on purpose: ≤10 calls, most served from the 30-min cache. Firing
  // them in parallel on a cold cache risks a burst 429 from the free tier that
  // would fail every coin at once (no prior cache to fall back to).
  for (const coinId of topCoins) {
    // Guard per asset: a failed market_chart call (rate limit, no cache) must
    // not kill the entire history — skip the asset. An empty/short response
    // (200 with no prices, e.g. a brand-new coin) is also an exclusion:
    // otherwise the coin would silently contribute 0 to every bucket and
    // understate the portfolio value with no signal to the user.
    try {
      const data = await fetchMarketChart(coinId, vsCurrency, days)
      if (data.length === 0) {
        excludedAssets += 1
        continue
      }
      series.set(coinId, data)
    } catch (err) {
      console.warn(`[history] market_chart für ${coinId} fehlgeschlagen, übersprungen: ${String(err)}`)
      excludedAssets += 1
    }
  }

  const now = Date.now()
  const spanMs = days * 24 * 60 * 60 * 1000
  const points = Array.from({ length: buckets + 1 }, (_, i) => {
    const t = now - spanMs + (spanMs * i) / buckets
    let total = ZERO
    for (const [coinId, coinSeries] of series) {
      const price = priceAt(coinSeries, t)
      if (price === null) continue
      total = total.add((byCoin.get(coinId) ?? ZERO).mul(new Prisma.Decimal(price)))
    }
    return { t: new Date(t).toISOString(), value: total.toFixed(2) }
  })

  return { range, currency, points, excludedAssets }
}

// Manual price refresh for all of the user's assets
export async function refreshUserPrices(
  userId: string,
  portfolioId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const pid = await resolvePortfolioId(userId, portfolioId)
  const holdings = await prisma.holding.findMany({
    where: { source: { userId, portfolioId: pid } },
    select: { assetId: true },
  })
  return refreshPrices([...new Set(holdings.map((h) => h.assetId))])
}
