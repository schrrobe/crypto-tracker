import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { fetchSimplePrices } from './coingecko.client'

// 60s-Cache pro Asset: schützt das CoinGecko-Rate-Limit bei mehreren Syncs hintereinander
const CACHE_TTL_MS = 60_000
const lastFetched = new Map<string, number>()

export interface LatestPrice {
  priceEur: Prisma.Decimal
  priceUsd: Prisma.Decimal
  fetchedAt: Date
}

// Holt aktuelle Preise für die Assets und schreibt sie append-only in AssetPrice.
// Wirft bewusst nicht bei Provider-Fehlern nach außen — Aufrufer entscheidet (Sync soll
// nicht an Preisen scheitern); Rückgabe meldet Erfolg.
export async function refreshPrices(assetIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const now = Date.now()
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds }, coingeckoId: { not: null } },
  })
  const stale = assets.filter((a) => (lastFetched.get(a.id) ?? 0) < now - CACHE_TTL_MS)
  if (stale.length === 0) return { ok: true }

  try {
    const prices = await fetchSimplePrices(stale.map((a) => a.coingeckoId as string))
    const rows = stale.flatMap((asset) => {
      const p = prices[asset.coingeckoId as string]
      if (p?.eur === undefined || p?.usd === undefined) return []
      lastFetched.set(asset.id, now)
      return [
        {
          assetId: asset.id,
          priceEur: new Prisma.Decimal(p.eur),
          priceUsd: new Prisma.Decimal(p.usd),
        },
      ]
    })
    if (rows.length > 0) await prisma.assetPrice.createMany({ data: rows })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Cron-Einstieg (Queue-Worker): Preise aller aktuell gehaltenen Assets auffrischen
export async function refreshAllHeldPrices(): Promise<{ ok: boolean; error?: string; assets: number }> {
  const held = await prisma.holding.findMany({ select: { assetId: true }, distinct: ['assetId'] })
  const assetIds = held.map((h) => h.assetId)
  if (assetIds.length === 0) return { ok: true, assets: 0 }
  const result = await refreshPrices(assetIds)
  return { ...result, assets: assetIds.length }
}

// Jüngster Preis je Asset (append-only Tabelle → distinct + orderBy)
export async function getLatestPrices(assetIds: string[]): Promise<Map<string, LatestPrice>> {
  if (assetIds.length === 0) return new Map()
  const rows = await prisma.assetPrice.findMany({
    where: { assetId: { in: assetIds } },
    orderBy: { fetchedAt: 'desc' },
    distinct: ['assetId'],
  })
  return new Map(
    rows.map((r) => [r.assetId, { priceEur: r.priceEur, priceUsd: r.priceUsd, fetchedAt: r.fetchedAt }]),
  )
}
