import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../lib/prisma'
import { registerUser, createManualSource } from '../../integration/helpers'
import { createHolding } from '../holdings/holdings.service'
import { getSummary, getHistory } from './portfolio.service'

// FAKE_PRICES (vitest.config) returns { eur: 1, usd: 1.1 } for any coingeckoId not in its
// fixed table → a random coingeckoId gives a deterministic, controllable price of 1 EUR.
const createdAssetIds: string[] = []

async function mappedAsset(symbol: string): Promise<string> {
  const asset = await prisma.asset.create({
    data: { symbol, name: `${symbol} Coin`, coingeckoId: `cg-${Math.random().toString(36).slice(2)}` },
  })
  createdAssetIds.push(asset.id)
  return asset.id
}

async function unmappedAsset(symbol: string): Promise<string> {
  const asset = await prisma.asset.create({ data: { symbol, name: `${symbol} Coin`, coingeckoId: null } })
  createdAssetIds.push(asset.id)
  return asset.id
}

afterAll(async () => {
  // Holdings reference assets without a cascade — remove them before the assets.
  await prisma.holding.deleteMany({ where: { assetId: { in: createdAssetIds } } })
  await prisma.asset.deleteMany({ where: { id: { in: createdAssetIds } } })
})

describe('getSummary', () => {
  it('leeres Portfolio: Gesamtwert 0.00, keine Positionen, kein Crash', async () => {
    const user = await registerUser('psum-empty')
    const summary = await getSummary(user.userId)
    expect(summary.totalEur).toBe('0.00')
    expect(summary.totalUsd).toBe('0.00')
    expect(summary.byAsset).toEqual([])
    expect(summary.unmappedAssets).toEqual([])
  })

  it('unmapped Asset: erscheint in unmappedAssets, valueEur null, zählt nicht in den Gesamtwert', async () => {
    const user = await registerUser('psum-unmapped')
    const source = await createManualSource(user, 'Manual')
    const assetId = await unmappedAsset('NOPRICE')
    await createHolding(user.userId, source.id, { assetId, quantity: '5' })

    const summary = await getSummary(user.userId)
    expect(summary.totalEur).toBe('0.00')
    expect(summary.unmappedAssets.map((a) => a.id)).toContain(assetId)
    const pos = summary.byAsset.find((p) => p.asset.id === assetId)
    expect(pos?.valueEur).toBeNull()
  })

  it('gleiches Asset über mehrere Quellen: Menge wird aggregiert, Wert = Summe × Preis', async () => {
    const user = await registerUser('psum-multi')
    const s1 = await createManualSource(user, 'Quelle A')
    const s2 = await createManualSource(user, 'Quelle B')
    const assetId = await mappedAsset('MULTI')
    await createHolding(user.userId, s1.id, { assetId, quantity: '0.1' })
    await createHolding(user.userId, s2.id, { assetId, quantity: '0.2' })

    const summary = await getSummary(user.userId)
    const pos = summary.byAsset.find((p) => p.asset.id === assetId)
    expect(pos?.quantity).toBe('0.3')
    // price = 1 EUR (fake fallback) → 0.3 EUR; 1.1 USD → 0.33 USD
    expect(pos?.valueEur).toBe('0.30')
    expect(pos?.valueUsd).toBe('0.33')
    expect(summary.totalEur).toBe('0.30')
  })

  it('gemapptes Asset ohne aktuellen Preis: NICHT als unmapped gelabelt, bleibt in byAsset mit valueEur null', async () => {
    const user = await registerUser('psum-priceless')
    const source = await createManualSource(user, 'Manual')
    const assetId = await mappedAsset('PRICELESS') // has coingeckoId
    await createHolding(user.userId, source.id, { assetId, quantity: '1' })
    // Simulate a temporarily missing price (e.g. partial CoinGecko response).
    await prisma.assetPrice.deleteMany({ where: { assetId } })

    const summary = await getSummary(user.userId)
    // Mapped asset must NOT be relabelled as unmapped just because its price is missing.
    expect(summary.unmappedAssets.map((a) => a.id)).not.toContain(assetId)
    const pos = summary.byAsset.find((p) => p.asset.id === assetId)
    expect(pos).toBeDefined()
    expect(pos?.valueEur).toBeNull()
  })

  it('pricesFetchedAt ist gesetzt, sobald mindestens eine Position einen Preis hat', async () => {
    const user = await registerUser('psum-fetched')
    const source = await createManualSource(user, 'Manual')
    const assetId = await mappedAsset('PXAT')
    await createHolding(user.userId, source.id, { assetId, quantity: '1' })

    const summary = await getSummary(user.userId)
    expect(summary.pricesFetchedAt).not.toBeNull()
  })
})

describe('getHistory', () => {
  it('nur unmapped Assets: keine Punkte, excludedAssets zählt das fehlende Asset', async () => {
    const user = await registerUser('phist-unmapped')
    const source = await createManualSource(user, 'Manual')
    const assetId = await unmappedAsset('NOHIST')
    await createHolding(user.userId, source.id, { assetId, quantity: '5' })

    const history = await getHistory(user.userId, '24h', 'EUR')
    expect(history.points).toEqual([])
    expect(history.excludedAssets).toBeGreaterThanOrEqual(1)
  })

  it('gemapptes Asset: liefert buckets+1 Punkte mit numerischen Werten', async () => {
    const user = await registerUser('phist-mapped')
    const source = await createManualSource(user, 'Manual')
    const assetId = await mappedAsset('HASH')
    await createHolding(user.userId, source.id, { assetId, quantity: '2' })

    const history = await getHistory(user.userId, '24h', 'EUR')
    // RANGE_CONFIG['24h'].buckets = 24 → 25 Punkte
    expect(history.points).toHaveLength(25)
    expect(history.points.every((p) => !Number.isNaN(Number(p.value)))).toBe(true)
  })
})
