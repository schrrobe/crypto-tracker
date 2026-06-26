import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { fetchSimplePrices } from './coingecko.client'

// 60s cache per asset: protects the CoinGecko rate limit across several syncs in a row.
// NOTE: module-level state → the guard is per-process. Once background sync runs across
// multiple workers (planned BullMQ) this must move to a shared store (DB/Redis), otherwise
// each worker keeps its own 60s window and the global rate limit can still be exceeded.
const CACHE_TTL_MS = 60_000
// Bounded so the map cannot grow without limit across the asset key space (mirrors the
// size-bounded caches in coingecko.client). Plenty for the held-asset count.
const LAST_FETCHED_MAX = 1000
const lastFetched = new Map<string, number>()

function markFetched(assetId: string, at: number): void {
  if (!lastFetched.has(assetId) && lastFetched.size >= LAST_FETCHED_MAX) {
    const oldest = lastFetched.keys().next().value
    if (oldest !== undefined) lastFetched.delete(oldest)
  }
  lastFetched.set(assetId, at)
}

// fetchedAt truncated to the minute (UTC) → the idempotency bucket. Derived from the
// timestamp, never from a second "now()", so two writes in the same minute collide on
// @@unique([assetId, bucketAt]) and skipDuplicates drops the redundant one.
function bucketOf(now: number): Date {
  return new Date(Math.floor(now / 60_000) * 60_000)
}

export interface LatestPrice {
  priceEur: Prisma.Decimal
  priceUsd: Prisma.Decimal
  fetchedAt: Date
}

// Fetches current prices for the assets and writes them append-only into AssetPrice.
// Deliberately does not throw on provider errors — the caller decides (sync should
// not fail on prices); the return value reports success.
export async function refreshPrices(assetIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const now = Date.now()
  const assets = await prisma.asset.findMany({
    where: { id: { in: assetIds }, coingeckoId: { not: null } },
  })
  const stale = assets.filter((a) => (lastFetched.get(a.id) ?? 0) < now - CACHE_TTL_MS)
  if (stale.length === 0) return { ok: true }
  // NOTE (bewusst offen, Eng-Review C2): kein Negativ-Cache. Ein gemapptes Asset, für
  // das CoinGecko (noch) keinen Preis liefert, wird bei jedem Aufruf erneut angefragt.
  // Bei Personal-Scale (wenige Assets, 1 Prozess) unkritisch; ein Backoff lohnt erst mit
  // dem Mehr-Worker-Hintergrundsync.

  try {
    const prices = await fetchSimplePrices(stale.map((a) => a.coingeckoId as string))
    const bucketAt = bucketOf(now)
    const fetchedAt = new Date(now)
    const rows = stale.flatMap((asset) => {
      const p = prices[asset.coingeckoId as string]
      if (p?.eur === undefined || p?.usd === undefined) return []
      return [
        {
          assetId: asset.id,
          priceEur: new Prisma.Decimal(p.eur),
          priceUsd: new Prisma.Decimal(p.usd),
          fetchedAt,
          bucketAt,
        },
      ]
    })
    if (rows.length > 0) {
      // skipDuplicates: a concurrent caller (or another worker) may have already written
      // this asset's (assetId, bucketAt) row. The unique constraint makes the write
      // idempotent; we log how many were skipped so a future race/cache bug stays visible
      // instead of disappearing into a "successful" write.
      const { count } = await prisma.assetPrice.createMany({ data: rows, skipDuplicates: true })
      const skipped = rows.length - count
      if (skipped > 0) {
        console.warn(`[prices] ${skipped}/${rows.length} AssetPrice-Zeilen übersprungen (Bucket bereits vorhanden)`)
      }
    }
    // Mark fetched only AFTER a successful write — otherwise a failed createMany would
    // leave the cache "fresh" with no row, and getLatestPrices would return nothing for
    // the next 60s. Mark every priced asset (skipped-duplicate rows included: the bucket
    // is already covered, so the cache should still suppress re-fetching).
    for (const r of rows) markFetched(r.assetId, now)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Cron entry point (queue worker): refresh prices of all currently held assets
export async function refreshAllHeldPrices(): Promise<{ ok: boolean; error?: string; assets: number }> {
  const held = await prisma.holding.findMany({ select: { assetId: true }, distinct: ['assetId'] })
  const assetIds = held.map((h) => h.assetId)
  if (assetIds.length === 0) return { ok: true, assets: 0 }
  const result = await refreshPrices(assetIds)
  return { ...result, assets: assetIds.length }
}

// Most recent price per asset (append-only table → distinct + orderBy)
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
