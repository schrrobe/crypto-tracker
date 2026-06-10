import { Prisma } from '@prisma/client'
import type { PortfolioSummaryDto, PortfolioAssetPosition, AssetDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { getLatestPrices, refreshPrices } from '../../coingecko/price.service'

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

// Manueller Preis-Refresh für alle Assets des Users
export async function refreshUserPrices(userId: string): Promise<{ ok: boolean; error?: string }> {
  const holdings = await prisma.holding.findMany({
    where: { source: { userId } },
    select: { assetId: true },
  })
  return refreshPrices([...new Set(holdings.map((h) => h.assetId))])
}
