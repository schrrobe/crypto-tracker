import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

vi.mock('../../coingecko/coingecko.client', () => ({
  fetchHistoricalPrice: vi.fn(),
}))

import { fetchHistoricalPrice } from '../../coingecko/coingecko.client'
import { priceKey, resolveHistoricalPrices } from './historical-price.service'

const mockedFetch = vi.mocked(fetchHistoricalPrice)
const DATE = new Date('2024-05-10T15:30:00.000Z') // normalized to 00:00 UTC

async function createTestAsset(coingeckoId: string | null) {
  return prisma.asset.create({
    data: {
      symbol: `HPT${Date.now()}${Math.floor(Math.random() * 1000)}`,
      name: 'Historical Price Test',
      coingeckoId,
    },
  })
}

describe('historical-price.service', () => {
  beforeEach(() => {
    mockedFetch.mockReset()
  })
  afterEach(async () => {
    await prisma.historicalAssetPrice.deleteMany({
      where: { asset: { name: 'Historical Price Test' } },
    })
    await prisma.asset.deleteMany({ where: { name: 'Historical Price Test' } })
  })

  it('cached Preise erzeugen keinen Client-Call', async () => {
    const asset = await createTestAsset(`hpt-cached-${Date.now()}`)
    await prisma.historicalAssetPrice.create({
      data: { assetId: asset.id, date: new Date('2024-05-10'), priceEur: new Prisma.Decimal('123.45') },
    })

    const result = await resolveHistoricalPrices([
      { assetId: asset.id, coingeckoId: asset.coingeckoId, date: DATE },
    ])

    expect(mockedFetch).not.toHaveBeenCalled()
    expect(result.prices.get(priceKey(asset.id, DATE))?.toString()).toBe('123.45')
    expect(result.limitReached).toBe(false)
  })

  it('Lookup wird gecached, Negativ-Ergebnis ebenfalls (kein zweiter Call)', async () => {
    const asset = await createTestAsset(`hpt-neg-${Date.now()}`)
    mockedFetch.mockResolvedValueOnce(null)

    const first = await resolveHistoricalPrices([
      { assetId: asset.id, coingeckoId: asset.coingeckoId, date: DATE },
    ])
    expect(first.prices.get(priceKey(asset.id, DATE))).toBeNull()
    expect(mockedFetch).toHaveBeenCalledTimes(1)

    // second run: the negative cache kicks in
    const second = await resolveHistoricalPrices([
      { assetId: asset.id, coingeckoId: asset.coingeckoId, date: DATE },
    ])
    expect(second.prices.get(priceKey(asset.id, DATE))).toBeNull()
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('unmapped Assets liefern null ohne Lookup', async () => {
    const asset = await createTestAsset(null)
    const result = await resolveHistoricalPrices([
      { assetId: asset.id, coingeckoId: null, date: DATE },
    ])
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(result.prices.get(priceKey(asset.id, DATE))).toBeNull()
  })

  it('dedupliziert identische (Asset, Tag)-Paare', async () => {
    const asset = await createTestAsset(`hpt-dedupe-${Date.now()}`)
    mockedFetch.mockResolvedValue(100)

    await resolveHistoricalPrices([
      { assetId: asset.id, coingeckoId: asset.coingeckoId, date: new Date('2024-05-10T01:00:00Z') },
      { assetId: asset.id, coingeckoId: asset.coingeckoId, date: new Date('2024-05-10T23:00:00Z') },
    ])
    expect(mockedFetch).toHaveBeenCalledTimes(1)
  })

  it('Cap begrenzt Lookups pro Lauf und meldet limitReached', async () => {
    const asset = await createTestAsset(`hpt-cap-${Date.now()}`)
    mockedFetch.mockResolvedValue(50)

    // 45 distinct days > cap (40)
    const requests = Array.from({ length: 45 }, (_, i) => ({
      assetId: asset.id,
      coingeckoId: asset.coingeckoId,
      date: new Date(Date.UTC(2024, 0, 1 + i)),
    }))
    const result = await resolveHistoricalPrices(requests)

    expect(mockedFetch).toHaveBeenCalledTimes(40)
    expect(result.limitReached).toBe(true)
    expect([...result.prices.keys()]).toHaveLength(40)
  })
})
