import { Prisma } from '@prisma/client'
import type { PnlPositionDto, PortfolioPnlDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { getLatestPrices } from '../../coingecko/price.service'
import { resolvePortfolioId } from '../portfolios/portfolios.service'
import { loadEnrichedTransactions } from '../tax/tax.service'
import { computeHoldingsCostBasis } from '../tax/tax.engine'

const ZERO = new Prisma.Decimal(0)

// Unrealisierter Gewinn/Verlust (Pro): aktueller Wert − FIFO-Kostenbasis je
// (Quelle, Asset). Nur Bestände mit Transaktionshistorie haben eine Kostenbasis;
// reine Snapshot-Quellen (Sync) fehlen bewusst. Alles in EUR (Tax-Engine-Basis).
export async function getPnl(userId: string, portfolioId?: string): Promise<PortfolioPnlDto> {
  const pid = await resolvePortfolioId(userId, portfolioId)

  const txs = await loadEnrichedTransactions(userId, pid)
  const costBasis = computeHoldingsCostBasis(txs)

  const holdings = await prisma.holding.findMany({
    where: { source: { userId, portfolioId: pid } },
    include: { asset: true, source: true },
  })
  const prices = await getLatestPrices(holdings.map((h) => h.assetId))

  let totalCostBasis = ZERO
  let totalValue = ZERO
  const positions: PnlPositionDto[] = []

  for (const h of holdings) {
    const basis = costBasis.get(`${h.sourceId}|${h.assetId}`)
    const price = prices.get(h.assetId)
    if (!basis || !price) continue // keine Kostenbasis (Snapshot) oder kein Preis → kein PnL

    const valueEur = h.quantity.mul(price.priceEur)
    const pnlEur = valueEur.sub(basis.costBasisEur)
    const pnlPct = basis.costBasisEur.gt(0)
      ? Number(pnlEur.div(basis.costBasisEur).mul(100).toFixed(2))
      : 0

    totalCostBasis = totalCostBasis.add(basis.costBasisEur)
    totalValue = totalValue.add(valueEur)

    positions.push({
      sourceId: h.sourceId,
      sourceLabel: h.source.label,
      assetSymbol: h.asset.symbol,
      assetName: h.asset.name,
      quantity: h.quantity.toString(),
      costBasisEur: basis.costBasisEur.toFixed(2),
      valueEur: valueEur.toFixed(2),
      pnlEur: pnlEur.toFixed(2),
      pnlPct,
    })
  }

  // größter absoluter Beitrag zuerst
  positions.sort((a, b) => Math.abs(Number(b.pnlEur)) - Math.abs(Number(a.pnlEur)))

  const totalPnl = totalValue.sub(totalCostBasis)
  return {
    totalCostBasisEur: totalCostBasis.toFixed(2),
    totalValueEur: totalValue.toFixed(2),
    totalPnlEur: totalPnl.toFixed(2),
    totalPnlPct: totalCostBasis.gt(0)
      ? Number(totalPnl.div(totalCostBasis).mul(100).toFixed(2))
      : 0,
    positions,
  }
}
