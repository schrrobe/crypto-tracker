import { Prisma } from '@prisma/client'
import type { PnlPositionDto, PortfolioPnlDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { getLatestPrices } from '../../coingecko/price.service'
import { resolvePortfolioId } from '../portfolios/portfolios.service'
import { loadEnrichedTransactions } from '../tax/tax.service'
import { computeHoldingsCostBasis } from '../tax/tax.engine'

const ZERO = new Prisma.Decimal(0)

// Gewinn/Verlust in % der Kostenbasis (0 wenn keine Basis vorhanden)
function pctOf(pnl: Prisma.Decimal, basis: Prisma.Decimal): number {
  return basis.gt(0) ? Number(pnl.div(basis).mul(100).toFixed(2)) : 0
}

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

  // Bestände über Konto-Typen (SPOT/EARN/MARGIN/FUTURES) je (Quelle, Asset)
  // zusammenfassen: die FIFO-Kostenbasis ist konto-typ-unabhängig (Transaktionen
  // kennen keinen Konto-Typ). Ohne das Summieren würde ein über mehrere Konto-Typen
  // verteiltes Asset die Basis mehrfach zählen bzw. an der Deckungsprüfung scheitern.
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
    if (!basis || !price) continue // keine Kostenbasis (Snapshot) oder kein Preis → kein PnL

    // Die Kostenbasis deckt nur die getrackte Menge ab. Weicht der Bestand davon
    // ab (z.B. Sync-Snapshot mit zusätzlichen Staking-Rewards: 100 Coins gehalten,
    // aber nur 2 aus Transaktionen), wäre der Wert (volle Menge) gegen eine
    // Teil-Basis gerechnet und der PnL grob überzeichnet → Position überspringen.
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

  // größter absoluter Beitrag zuerst
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
