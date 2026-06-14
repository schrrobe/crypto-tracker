import { Prisma } from '@prisma/client'
import type { PnlPositionDto, PortfolioPnlDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { getLatestPrices } from '../../coingecko/price.service'
import { resolvePortfolioId } from '../portfolios/portfolios.service'
import { loadEnrichedTransactions } from '../tax/tax.service'
import { computeHoldingsCostBasis } from '../tax/tax.engine'

const ZERO = new Prisma.Decimal(0)

// Profit/loss as % of the cost basis (0 if no basis is present)
function pctOf(pnl: Prisma.Decimal, basis: Prisma.Decimal): number {
  return basis.gt(0) ? Number(pnl.div(basis).mul(100).toFixed(2)) : 0
}

// Unrealized profit/loss (Pro): current value − FIFO cost basis per
// (source, asset). Only holdings with a transaction history have a cost basis;
// pure snapshot sources (sync) are deliberately absent. Everything in EUR (tax-engine basis).
export async function getPnl(userId: string, portfolioId?: string): Promise<PortfolioPnlDto> {
  const pid = await resolvePortfolioId(userId, portfolioId)

  const txs = await loadEnrichedTransactions(userId, pid)
  const costBasis = computeHoldingsCostBasis(txs)

  const holdings = await prisma.holding.findMany({
    where: { source: { userId, portfolioId: pid } },
    include: { asset: true, source: true },
  })
  const prices = await getLatestPrices(holdings.map((h) => h.assetId))

  // Combine holdings across account types (SPOT/EARN/MARGIN/FUTURES) per (source, asset):
  // the FIFO cost basis is account-type-independent (transactions don't know an
  // account type). Without summing, an asset spread across several account types
  // would count the basis multiple times or fail the coverage check.
  interface AggHolding {
    sourceId: string
    assetId: string
    sourceLabel: string
    assetSymbol: string
    assetName: string
    quantity: Prisma.Decimal
  }
  const bySourceAsset = new Map<string, AggHolding>()
  for (const h of holdings) {
    const key = `${h.sourceId}|${h.assetId}`
    const prev = bySourceAsset.get(key)
    if (prev) prev.quantity = prev.quantity.add(h.quantity)
    else
      bySourceAsset.set(key, {
        sourceId: h.sourceId,
        assetId: h.assetId,
        sourceLabel: h.source.label,
        assetSymbol: h.asset.symbol,
        assetName: h.asset.name,
        quantity: h.quantity,
      })
  }

  let totalCostBasis = ZERO
  let totalValue = ZERO
  const positions: PnlPositionDto[] = []

  for (const h of bySourceAsset.values()) {
    const basis = costBasis.get(`${h.sourceId}|${h.assetId}`)
    const price = prices.get(h.assetId)
    if (!basis || !price) continue // no cost basis (snapshot) or no price → no PnL

    // The cost basis only covers the tracked quantity. If the holding deviates
    // from it (e.g. a sync snapshot with extra staking rewards: 100 coins held,
    // but only 2 from transactions), the value (full quantity) would be computed
    // against a partial basis and the PnL grossly overstated → skip the position.
    const coverageDiff = basis.quantity.sub(h.quantity).abs()
    if (coverageDiff.gt(h.quantity.abs().mul('0.005'))) continue

    const valueEur = h.quantity.mul(price.priceEur)
    const pnlEur = valueEur.sub(basis.costBasisEur)
    const pnlPct = pctOf(pnlEur, basis.costBasisEur)

    totalCostBasis = totalCostBasis.add(basis.costBasisEur)
    totalValue = totalValue.add(valueEur)

    positions.push({
      sourceId: h.sourceId,
      sourceLabel: h.sourceLabel,
      assetSymbol: h.assetSymbol,
      assetName: h.assetName,
      quantity: h.quantity.toString(),
      costBasisEur: basis.costBasisEur.toFixed(2),
      valueEur: valueEur.toFixed(2),
      pnlEur: pnlEur.toFixed(2),
      pnlPct,
    })
  }

  // largest absolute contribution first
  positions.sort((a, b) => Math.abs(Number(b.pnlEur)) - Math.abs(Number(a.pnlEur)))

  const totalPnl = totalValue.sub(totalCostBasis)
  return {
    totalCostBasisEur: totalCostBasis.toFixed(2),
    totalValueEur: totalValue.toFixed(2),
    totalPnlEur: totalPnl.toFixed(2),
    totalPnlPct: pctOf(totalPnl, totalCostBasis),
    positions,
  }
}
