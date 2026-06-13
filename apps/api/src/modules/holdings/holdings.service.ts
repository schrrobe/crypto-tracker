import { Prisma } from '@prisma/client'
import type { HoldingDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { getOwnedSource } from '../sources/sources.service'
import { getLatestPrices, refreshPrices } from '../../coingecko/price.service'
import { resolvePortfolioId } from '../portfolios/portfolios.service'

type HoldingWithRelations = Prisma.HoldingGetPayload<{ include: { asset: true; source: true } }>

function toHoldingDto(
  h: HoldingWithRelations,
  prices: Map<string, { priceEur: Prisma.Decimal; priceUsd: Prisma.Decimal }>,
): HoldingDto {
  const price = prices.get(h.assetId)
  return {
    id: h.id,
    sourceId: h.sourceId,
    sourceLabel: h.source.label,
    sourceType: h.source.type,
    asset: {
      id: h.asset.id,
      symbol: h.asset.symbol,
      name: h.asset.name,
      coingeckoId: h.asset.coingeckoId,
      iconUrl: h.asset.iconUrl,
    },
    quantity: h.quantity.toString(),
    valueEur: price ? h.quantity.mul(price.priceEur).toFixed(2) : null,
    valueUsd: price ? h.quantity.mul(price.priceUsd).toFixed(2) : null,
  }
}

export async function listHoldings(userId: string, portfolioId?: string): Promise<HoldingDto[]> {
  const pid = await resolvePortfolioId(userId, portfolioId)
  const holdings = await prisma.holding.findMany({
    where: { source: { userId, portfolioId: pid } },
    include: { asset: true, source: true },
    orderBy: { updatedAt: 'desc' },
  })
  const prices = await getLatestPrices(holdings.map((h) => h.assetId))
  return holdings.map((h) => toHoldingDto(h, prices))
}

async function getManualSource(userId: string, sourceId: string) {
  const source = await getOwnedSource(userId, sourceId)
  if (source.type !== 'MANUAL') {
    throw AppError.badRequest(
      'NOT_A_MANUAL_SOURCE',
      'Bestände können nur in manuellen Quellen direkt bearbeitet werden',
    )
  }
  // Quellen mit Transaktionen leiten ihre Bestände aus diesen ab — direkte
  // Holding-Edits würden mit dem Recompute kollidieren
  const txCount = await prisma.transaction.count({ where: { sourceId } })
  if (txCount > 0) {
    throw AppError.conflict(
      'SOURCE_HAS_TRANSACTIONS',
      'Bestände dieser Quelle werden aus Transaktionen berechnet — bitte die Transaktionen bearbeiten',
    )
  }
  return source
}

export async function createHolding(
  userId: string,
  sourceId: string,
  data: { assetId: string; quantity: string },
): Promise<HoldingDto> {
  await getManualSource(userId, sourceId)
  const asset = await prisma.asset.findUnique({ where: { id: data.assetId } })
  if (!asset) throw AppError.notFound('Asset nicht gefunden')

  const existing = await prisma.holding.findUnique({
    where: { sourceId_assetId: { sourceId, assetId: data.assetId } },
  })
  if (existing) {
    throw AppError.conflict('ASSET_ALREADY_IN_SOURCE', `${asset.symbol} ist in dieser Quelle bereits erfasst`)
  }

  const holding = await prisma.holding.create({
    data: { sourceId, assetId: data.assetId, quantity: new Prisma.Decimal(data.quantity) },
    include: { asset: true, source: true },
  })
  await refreshPrices([data.assetId])
  const prices = await getLatestPrices([data.assetId])
  return toHoldingDto(holding, prices)
}

export async function updateHolding(
  userId: string,
  sourceId: string,
  holdingId: string,
  quantity: string,
): Promise<HoldingDto> {
  await getManualSource(userId, sourceId)
  const existing = await prisma.holding.findFirst({ where: { id: holdingId, sourceId } })
  if (!existing) throw AppError.notFound('Bestand nicht gefunden')

  const holding = await prisma.holding.update({
    where: { id: holdingId },
    data: { quantity: new Prisma.Decimal(quantity) },
    include: { asset: true, source: true },
  })
  const prices = await getLatestPrices([holding.assetId])
  return toHoldingDto(holding, prices)
}

export async function deleteHolding(userId: string, sourceId: string, holdingId: string): Promise<void> {
  await getManualSource(userId, sourceId)
  const existing = await prisma.holding.findFirst({ where: { id: holdingId, sourceId } })
  if (!existing) throw AppError.notFound('Bestand nicht gefunden')
  await prisma.holding.delete({ where: { id: holdingId } })
}
