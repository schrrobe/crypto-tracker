import { Prisma } from '@prisma/client'
import type {
  HistoryRange,
  PortfolioAssetPosition,
  PortfolioHistoryDto,
  PortfolioSummaryDto,
  AssetDto,
} from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { getLatestPrices, refreshPrices } from '../../coingecko/price.service'
import { fetchMarketChart, type MarketChartPoint } from '../../coingecko/coingecko.client'

const ZERO = new Prisma.Decimal(0)

export async function getSummary(userId: string): Promise<PortfolioSummaryDto> {
  const holdings = await prisma.holding.findMany({
    where: { source: { userId } },
    include: { asset: true },
  })

  const assetIds = [...new Set(holdings.map((h) => h.assetId))]
  const prices = await getLatestPrices(assetIds)

  // Aggregation über alle Quellen je Asset
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
    } else {
      unmappedAssets.push(asset)
    }
    byAsset.push({ asset, quantity: quantity.toString(), valueEur, valueUsd })
  }

  // Größte Position zuerst
  byAsset.sort((a, b) => Number(b.valueEur ?? 0) - Number(a.valueEur ?? 0))

  return {
    totalEur: totalEur.toFixed(2),
    totalUsd: totalUsd.toFixed(2),
    pricesFetchedAt: pricesFetchedAt?.toISOString() ?? null,
    byAsset,
    unmappedAssets,
  }
}

const RANGE_CONFIG: Record<HistoryRange, { days: 1 | 7 | 30; buckets: number }> = {
  '24h': { days: 1, buckets: 24 },
  '7d': { days: 7, buckets: 28 },
  '30d': { days: 30, buckets: 30 },
}

// Begrenzte Asset-Anzahl pro Verlauf: 1 market_chart-Call pro Asset/Währung —
// Top-N nach aktuellem Wert deckt praktisch das gesamte Portfolio ab.
const HISTORY_MAX_ASSETS = 10

// Letzter bekannter Preis ≤ Bucket-Zeitpunkt (Serien verschiedener Coins haben
// leicht versetzte Zeitstempel)
function priceAt(series: MarketChartPoint[], timestampMs: number): number | null {
  let result: number | null = null
  for (const [t, price] of series) {
    if (t > timestampMs) break
    result = price
  }
  return result ?? (series[0] ? series[0][1] : null)
}

// Wertverlauf der AKTUELLEN Bestände zu historischen Preisen — bewusst keine
// Holdings-Historie (Käufe/Verkäufe in der Vergangenheit werden nicht zurückgerechnet).
export async function getHistory(
  userId: string,
  range: HistoryRange,
  currency: 'EUR' | 'USD',
): Promise<PortfolioHistoryDto> {
  const { days, buckets } = RANGE_CONFIG[range]

  const holdings = await prisma.holding.findMany({
    where: { source: { userId } },
    include: { asset: { select: { coingeckoId: true } } },
  })

  // je Asset aggregieren; nur gemappte Assets haben eine Preis-Historie
  const byCoin = new Map<string, Prisma.Decimal>()
  let excludedAssets = 0
  for (const h of holdings) {
    const coinId = h.asset.coingeckoId
    if (!coinId) {
      excludedAssets += 1
      continue
    }
    byCoin.set(coinId, (byCoin.get(coinId) ?? ZERO).add(h.quantity))
  }

  if (byCoin.size === 0) return { range, currency, points: [], excludedAssets }

  // Top-N nach aktuellem Wert
  const prices = await getLatestPrices(holdings.map((h) => h.assetId))
  const currentValue = new Map<string, number>()
  for (const h of holdings) {
    const coinId = h.asset.coingeckoId
    const price = prices.get(h.assetId)
    if (!coinId || !price) continue
    const value = Number(h.quantity.mul(currency === 'EUR' ? price.priceEur : price.priceUsd))
    currentValue.set(coinId, (currentValue.get(coinId) ?? 0) + value)
  }
  const topCoins = [...byCoin.keys()]
    .sort((a, b) => (currentValue.get(b) ?? 0) - (currentValue.get(a) ?? 0))
    .slice(0, HISTORY_MAX_ASSETS)
  excludedAssets += byCoin.size - topCoins.length

  const vsCurrency = currency.toLowerCase() as 'eur' | 'usd'
  const series = new Map<string, MarketChartPoint[]>()
  for (const coinId of topCoins) {
    series.set(coinId, await fetchMarketChart(coinId, vsCurrency, days))
  }

  const now = Date.now()
  const spanMs = days * 24 * 60 * 60 * 1000
  const points = Array.from({ length: buckets + 1 }, (_, i) => {
    const t = now - spanMs + (spanMs * i) / buckets
    let total = ZERO
    for (const coinId of topCoins) {
      const price = priceAt(series.get(coinId) ?? [], t)
      if (price === null) continue
      total = total.add((byCoin.get(coinId) ?? ZERO).mul(new Prisma.Decimal(price)))
    }
    return { t: new Date(t).toISOString(), value: total.toFixed(2) }
  })

  return { range, currency, points, excludedAssets }
}

// Manueller Preis-Refresh für alle Assets des Users
export async function refreshUserPrices(userId: string): Promise<{ ok: boolean; error?: string }> {
  const holdings = await prisma.holding.findMany({
    where: { source: { userId } },
    select: { assetId: true },
  })
  return refreshPrices([...new Set(holdings.map((h) => h.assetId))])
}
