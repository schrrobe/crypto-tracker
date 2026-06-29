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
    where: {
      source: { userId, portfolioId: pid },
      // PnL is a spot cost-basis concept. MARGIN/FUTURES have no spot FIFO basis
      // and can be negative (liabilities) — they have their own uPnL path and must
      // not be netted into spot quantity or inflate the excluded-value disclosure.
      accountType: { in: ['SPOT', 'EARN'] },
    },
    include: { asset: true, source: true },
  })
  const prices = await getLatestPrices(holdings.map((h) => h.assetId))

  // Combine the remaining long holdings (SPOT + EARN) per (source, asset): the FIFO
  // cost basis is transaction-derived and account-type-independent, so an asset
  // split across spot and earn must be summed to match the basis quantity once.
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
  // Coverage: holdings we can value (have a price) but exclude from PnL because
  // they have no transaction history / the basis doesn't cover the held quantity.
  // Surfaced to the client so the PnL total never reads as portfolio-wide when it
  // silently omits most of the portfolio.
  let excludedCount = 0
  let excludedValue = ZERO
  const positions: PnlPositionDto[] = []

  for (const h of bySourceAsset.values()) {
    if (h.quantity.lte(0)) continue // defensive: only long positions have spot PnL
    const basis = costBasis.get(`${h.sourceId}|${h.assetId}`)
    const price = prices.get(h.assetId)
    if (!price) continue // no price → can't value it at all, not part of coverage

    const heldValue = h.quantity.mul(price.priceEur)

    // No cost basis (pure snapshot / sync source) → can't compute PnL. Counts as
    // excluded value so the client can disclose "€X not included".
    if (!basis) {
      excludedCount++
      excludedValue = excludedValue.add(heldValue.abs())
      continue
    }

    // The cost basis only covers the tracked quantity. If the holding deviates
    // from it (e.g. a sync snapshot with extra staking rewards: 100 coins held,
    // but only 2 from transactions), the value (full quantity) would be computed
    // against a partial basis and the PnL grossly overstated → exclude the position.
    const coverageDiff = basis.quantity.sub(h.quantity).abs()
    if (coverageDiff.gt(h.quantity.abs().mul('0.005'))) {
      excludedCount++
      excludedValue = excludedValue.add(heldValue.abs())
      continue
    }

    const valueEur = heldValue
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
    // Coverage disclosure: positions covered vs. excluded (no tx history) + the
    // EUR value left out of the PnL total.
    coveredCount: positions.length,
    excludedCount,
    excludedValueEur: excludedValue.toFixed(2),
  }
}
