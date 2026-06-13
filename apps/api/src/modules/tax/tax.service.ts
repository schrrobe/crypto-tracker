import { Prisma } from '@prisma/client'
import type {
  TaxCountry,
  TaxDisposalDto,
  TaxReportDto,
  TaxWarningDto,
} from '@crypto-tracker/shared'
import { TaxWarningCode } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import {
  priceKey,
  resolveHistoricalPrices,
  type HistoricalPriceRequest,
} from './historical-price.service'
import { resolvePortfolioId } from '../portfolios/portfolios.service'
import {
  computeReportAT,
  computeReportDE,
  type EngineDisposal,
  type EngineReport,
  type EngineTx,
} from './tax.engine'

// Bewusst Express-frei (wie sync.service) — später auch aus Worker/Cron aufrufbar.

const TAX_TX_INCLUDE = {
  asset: true,
  source: { select: { label: true } },
  transferOut: { select: { id: true } },
  transferIn: { select: { id: true } },
} satisfies Prisma.TransactionInclude

type TxWithAsset = Prisma.TransactionGetPayload<{ include: typeof TAX_TX_INCLUDE }>

function transferGroupId(tx: TxWithAsset): string | null {
  return tx.transferOut?.id ?? tx.transferIn?.id ?? null
}

// Engine rechnet nur in EUR. Kurs in Fremdwährung wird verworfen (keine
// FX-Umrechnung in V1) und — wie fehlende Kurse — per Tagespreis-Backfill ersetzt.
async function enrichTransactions(
  txs: TxWithAsset[],
): Promise<{ engineTxs: EngineTx[]; warnings: TaxWarningDto[] }> {
  const warnings: TaxWarningDto[] = []
  const foreignCurrency = new Map<string, number>()

  interface Pending {
    tx: TxWithAsset
    priceEur: Prisma.Decimal | null
    feeEur: Prisma.Decimal | null
    needsBackfill: boolean
  }

  const pending: Pending[] = txs.map((tx) => {
    const isEur = tx.currency === null || tx.currency === 'EUR'
    if (tx.pricePerUnit !== null && isEur) {
      return { tx, priceEur: tx.pricePerUnit, feeEur: tx.feeAmount, needsBackfill: false }
    }
    if (tx.pricePerUnit !== null && !isEur) {
      foreignCurrency.set(tx.asset.symbol, (foreignCurrency.get(tx.asset.symbol) ?? 0) + 1)
    }
    // Kurs fehlt oder ist nicht in EUR → Backfill; Gebühr ist dann nicht verwertbar
    return { tx, priceEur: null, feeEur: null, needsBackfill: true }
  })

  for (const [assetSymbol, count] of foreignCurrency) {
    warnings.push({ code: TaxWarningCode.FOREIGN_CURRENCY_PRICE_IGNORED, assetSymbol, count })
  }

  // Nur Typen backfillen, deren Kurs steuerlich relevant ist
  // (STAKING_REWARD: DE braucht den Zuflusswert als Einkommen + Kostenbasis).
  // Verlinkte Transfer-Deposits brauchen keinen Kurs — ihre Basis kommt aus
  // den umgezogenen Slices (spart CoinGecko-Budget).
  const requests: HistoricalPriceRequest[] = pending
    .filter((p) => p.needsBackfill && ['BUY', 'SELL', 'DEPOSIT', 'STAKING_REWARD'].includes(p.tx.type))
    .filter((p) => !(p.tx.type === 'DEPOSIT' && transferGroupId(p.tx) !== null))
    .map((p) => ({ assetId: p.tx.assetId, coingeckoId: p.tx.asset.coingeckoId, date: p.tx.timestamp }))

  const { prices, limitReached } = await resolveHistoricalPrices(requests)
  if (limitReached) {
    warnings.push({ code: TaxWarningCode.PRICE_LOOKUP_LIMIT_REACHED })
  }

  const engineTxs: EngineTx[] = pending.map((p) => {
    let priceEur = p.priceEur
    let priceSource: EngineTx['priceSource'] = 'ORIGINAL'
    if (p.needsBackfill) {
      const backfilled = prices.get(priceKey(p.tx.assetId, p.tx.timestamp)) ?? null
      priceEur = backfilled
      priceSource = backfilled === null ? 'MISSING' : 'BACKFILLED'
    }
    return {
      id: p.tx.id,
      sourceId: p.tx.sourceId,
      assetId: p.tx.assetId,
      assetSymbol: p.tx.asset.symbol,
      assetName: p.tx.asset.name,
      type: p.tx.type,
      quantity: p.tx.quantity,
      priceEur,
      feeEur: p.feeEur,
      timestamp: p.tx.timestamp,
      priceSource,
      transferGroupId: transferGroupId(p.tx),
    }
  })

  return { engineTxs, warnings }
}

function toDisposalDto(d: EngineDisposal, sourceLabels: Map<string, string>): TaxDisposalDto {
  return {
    sourceLabel: sourceLabels.get(d.sourceId),
    assetSymbol: d.assetSymbol,
    assetName: d.assetName,
    acquiredAt: d.acquiredAt?.toISOString() ?? null,
    disposedAt: d.disposedAt.toISOString(),
    quantity: d.quantity.toString(),
    costBasisEur: d.costBasisEur.toFixed(2),
    proceedsEur: d.proceedsEur.toFixed(2),
    gainEur: d.gainEur.toFixed(2),
    taxable: d.taxable,
    regime: d.regime,
    priceQuality: d.priceQuality,
  }
}

export async function getReport(
  userId: string,
  year: number,
  country: TaxCountry,
  portfolioId?: string,
): Promise<TaxReportDto> {
  const pid = await resolvePortfolioId(userId, portfolioId)
  const txs = await prisma.transaction.findMany({
    where: { source: { userId, portfolioId: pid } },
    include: TAX_TX_INCLUDE,
    orderBy: { timestamp: 'asc' },
  })
  const sourceLabels = new Map(txs.map((tx) => [tx.sourceId, tx.source.label]))

  const { engineTxs, warnings: enrichmentWarnings } = await enrichTransactions(txs)
  const report: EngineReport =
    country === 'DE' ? computeReportDE(engineTxs, year) : computeReportAT(engineTxs, year)

  // Quellen mit Beständen, aber ohne Transaktionshistorie — für diese kann
  // keine Steuer berechnet werden; der Report weist sie explizit aus
  const uncovered = await prisma.portfolioSource.findMany({
    where: { userId, portfolioId: pid, holdings: { some: {} }, transactions: { none: {} } },
    select: { id: true, label: true, type: true },
    orderBy: { createdAt: 'asc' },
  })

  // Wallets mit ausschließlich Reward-Importen gelten nicht als „abgedeckt" —
  // ihre Käufe/Verkäufe fehlen weiterhin (Hinweis statt falscher Sicherheit)
  const rewardsOnlyWallets = await prisma.portfolioSource.count({
    where: {
      userId,
      portfolioId: pid,
      type: 'WALLET',
      transactions: { some: {} },
      NOT: { transactions: { some: { type: { not: 'STAKING_REWARD' } } } },
    },
  })
  const coverageWarnings: TaxWarningDto[] =
    rewardsOnlyWallets > 0
      ? [{ code: TaxWarningCode.WALLET_REWARDS_ONLY, count: rewardsOnlyWallets }]
      : []

  return {
    year,
    country,
    currency: 'EUR',
    disposals: report.disposals.map((d) => toDisposalDto(d, sourceLabels)),
    totals: {
      totalGainEur: report.totals.totalGainEur.toFixed(2),
      taxFreeGainEur: report.totals.taxFreeGainEur.toFixed(2),
      taxableGainEur: report.totals.taxableGainEur.toFixed(2),
      thresholdEur: report.totals.thresholdEur?.toFixed(2) ?? null,
      thresholdApplied: report.totals.thresholdApplied,
      taxableAfterThresholdEur: report.totals.taxableAfterThresholdEur.toFixed(2),
      ...(report.totals.atNeuvermoegenGainEur !== undefined
        ? { atNeuvermoegenGainEur: report.totals.atNeuvermoegenGainEur.toFixed(2) }
        : {}),
      ...(report.totals.stakingIncomeEur !== undefined
        ? {
            stakingIncomeEur: report.totals.stakingIncomeEur.toFixed(2),
            stakingThresholdEur: report.totals.stakingThresholdEur?.toFixed(2),
            stakingTaxableEur: report.totals.stakingTaxableEur?.toFixed(2),
          }
        : {}),
    },
    warnings: [...enrichmentWarnings, ...report.warnings, ...coverageWarnings],
    uncoveredSources: uncovered,
    generatedAt: new Date().toISOString(),
  }
}
