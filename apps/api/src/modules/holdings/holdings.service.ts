import { Prisma } from '@prisma/client'
import type { FuturesPositionDto, HoldingDto } from '@crypto-tracker/shared'
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
    accountType: h.accountType,
    quantity: h.quantity.toString(),
    valueEur: price ? h.quantity.mul(price.priceEur).toFixed(2) : null,
    valueUsd: price ? h.quantity.mul(price.priceUsd).toFixed(2) : null,
  }
}

type FuturesPositionWithRelations = Prisma.FuturesPositionGetPayload<{
  include: { asset: true; source: true }
}>

function toFuturesPositionDto(
  p: FuturesPositionWithRelations,
  prices: Map<string, { priceEur: Prisma.Decimal; priceUsd: Prisma.Decimal }>,
  stablePriceEur: Prisma.Decimal | null,
): FuturesPositionDto {
  // Notional = size × asset price (base asset → EUR)
  const price = p.assetId ? prices.get(p.assetId) : undefined
  const notionalEur = price ? p.size.mul(price.priceEur).toFixed(2) : null
  // The exchange reports uPnL in quoteCurrency (USDT/USDC ≈ USD) → EUR via the stablecoin price
  const upnlEur =
    p.unrealizedPnl !== null && stablePriceEur ? p.unrealizedPnl.mul(stablePriceEur).toFixed(2) : null
  return {
    id: p.id,
    sourceId: p.sourceId,
    sourceLabel: p.source.label,
    assetSymbol: p.asset?.symbol ?? p.rawSymbol,
    rawSymbol: p.rawSymbol,
    side: p.side,
    size: p.size.toString(),
    entryPrice: p.entryPrice?.toString() ?? null,
    markPrice: p.markPrice?.toString() ?? null,
    leverage: p.leverage ?? null,
    unrealizedPnl: p.unrealizedPnl?.toString() ?? null,
    quoteCurrency: p.quoteCurrency,
    unrealizedPnlEur: upnlEur,
    valueEur: notionalEur,
    liquidationPrice: p.liquidationPrice?.toString() ?? null,
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

// Exchange uPnL is denominated in USDT/USDC (≈ USD) — the EUR value is derived
// via the stablecoin price (tether). Null when no price is available.
async function stablePriceEur(): Promise<Prisma.Decimal | null> {
  const usdt = await prisma.asset.findUnique({ where: { coingeckoId: 'tether' } })
  if (!usdt) return null
  return (await getLatestPrices([usdt.id])).get(usdt.id)?.priceEur ?? null
}

export async function listFuturesPositions(userId: string, portfolioId?: string): Promise<FuturesPositionDto[]> {
  const pid = await resolvePortfolioId(userId, portfolioId)
  const positions = await prisma.futuresPosition.findMany({
    where: { source: { userId, portfolioId: pid } },
    include: { asset: true, source: true },
    orderBy: { updatedAt: 'desc' },
  })
  const prices = await getLatestPrices(positions.flatMap((p) => (p.assetId ? [p.assetId] : [])))
  const stable = await stablePriceEur()
  return positions.map((p) => toFuturesPositionDto(p, prices, stable))
}

async function getManualSource(userId: string, sourceId: string) {
  const source = await getOwnedSource(userId, sourceId)
  if (source.type !== 'MANUAL') {
    throw AppError.badRequest(
      'NOT_A_MANUAL_SOURCE',
      'Bestände können nur in manuellen Quellen direkt bearbeitet werden',
    )
  }
  // Sources with transactions derive their holdings from them — direct
  // holding edits would collide with the recompute
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

  // manual holdings are always SPOT
  const existing = await prisma.holding.findUnique({
    where: { sourceId_assetId_accountType: { sourceId, assetId: data.assetId, accountType: 'SPOT' } },
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
