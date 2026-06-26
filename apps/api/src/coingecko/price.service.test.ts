import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { getLatestPrices, refreshPrices } from './price.service'

// The provider is the boundary — mock it so we test the SERVICE logic (60s cache,
// idempotent writes, error handling, cache-after-write ordering) against a real DB.
vi.mock('./coingecko.client', () => ({ fetchSimplePrices: vi.fn() }))
import { fetchSimplePrices } from './coingecko.client'
const mockFetch = vi.mocked(fetchSimplePrices)

const createdAssetIds: string[] = []

// Fresh asset per test → never in the module-level lastFetched cache, so each test
// starts uncached regardless of order.
async function freshAsset(): Promise<{ id: string; coingeckoId: string }> {
  const coingeckoId = `cg-${Math.random().toString(36).slice(2)}-${createdAssetIds.length}`
  const asset = await prisma.asset.create({
    data: { symbol: 'TST', name: 'Test Coin', coingeckoId },
  })
  createdAssetIds.push(asset.id)
  return { id: asset.id, coingeckoId }
}

function countPrices(assetId: string): Promise<number> {
  return prisma.assetPrice.count({ where: { assetId } })
}

beforeEach(() => {
  mockFetch.mockReset()
})

afterAll(async () => {
  // cascade removes AssetPrice rows
  await prisma.asset.deleteMany({ where: { id: { in: createdAssetIds } } })
})

describe('refreshPrices', () => {
  it('60s-Cache: zweiter Aufruf innerhalb 60s fetcht nicht erneut und schreibt keine zweite Zeile', async () => {
    const asset = await freshAsset()
    mockFetch.mockResolvedValue({ [asset.coingeckoId]: { eur: 50_000, usd: 55_000 } })

    expect(await refreshPrices([asset.id])).toEqual({ ok: true })
    expect(await refreshPrices([asset.id])).toEqual({ ok: true })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(await countPrices(asset.id)).toBe(1)
  })

  it('idempotent unter Nebenläufigkeit: zwei parallele Aufrufe schreiben genau eine Zeile (gleicher Minuten-Bucket)', async () => {
    const asset = await freshAsset()
    mockFetch.mockResolvedValue({ [asset.coingeckoId]: { eur: 50_000, usd: 55_000 } })

    const [a, b] = await Promise.all([refreshPrices([asset.id]), refreshPrices([asset.id])])
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })

    // Both pass the stale filter (neither cached at start) and target the same
    // (assetId, bucketAt); skipDuplicates collapses them to one row.
    expect(await countPrices(asset.id)).toBe(1)
  })

  it('fehlender Preis: kein Crash, keine Zeile, getLatestPrices leer', async () => {
    const asset = await freshAsset()
    mockFetch.mockResolvedValue({}) // provider returned no entry for this coin

    expect(await refreshPrices([asset.id])).toEqual({ ok: true })
    expect(await countPrices(asset.id)).toBe(0)
    expect((await getLatestPrices([asset.id])).size).toBe(0)
  })

  it('Provider-Fehler (z.B. 429): refreshPrices wirft nicht, liefert ok:false und schreibt nichts', async () => {
    const asset = await freshAsset()
    mockFetch.mockRejectedValue(new Error('CoinGecko antwortet mit 429'))

    const res = await refreshPrices([asset.id])
    expect(res.ok).toBe(false)
    expect(res.error).toContain('429')
    expect(await countPrices(asset.id)).toBe(0)
  })

  it('Cache wird erst NACH erfolgreichem Write gesetzt: nach einem Fehler holt der nächste Aufruf den Preis nach', async () => {
    const asset = await freshAsset()
    // First attempt fails → cache must NOT be marked fresh.
    mockFetch.mockRejectedValueOnce(new Error('CoinGecko antwortet mit 429'))
    expect((await refreshPrices([asset.id])).ok).toBe(false)
    expect(await countPrices(asset.id)).toBe(0)

    // Next attempt succeeds → asset is still considered stale, so it fetches and writes.
    mockFetch.mockResolvedValue({ [asset.coingeckoId]: { eur: 50_000, usd: 55_000 } })
    expect((await refreshPrices([asset.id])).ok).toBe(true)
    expect(await countPrices(asset.id)).toBe(1)
  })
})

describe('getLatestPrices', () => {
  it('liefert die jüngste Zeile je Asset', async () => {
    const asset = await freshAsset()
    mockFetch.mockResolvedValue({ [asset.coingeckoId]: { eur: 50_000, usd: 55_000 } })
    await refreshPrices([asset.id])

    const latest = (await getLatestPrices([asset.id])).get(asset.id)
    expect(latest?.priceEur.toString()).toBe('50000')
    expect(latest?.priceUsd.toString()).toBe('55000')
  })
})
