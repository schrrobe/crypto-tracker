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

// Deliberately Express-free (like sync.service) — also callable from a worker/cron later.

const TAX_TX_INCLUDE = {
  asset: true,
  source: { select: { label: true } },
  transferOut: { select: { id: true } },
  transferIn: { select: { id: true } },
  swapOut: { select: { id: true } },
  swapIn: { select: { id: true } },
} satisfies Prisma.TransactionInclude

type TxWithAsset = Prisma.TransactionGetPayload<{ include: typeof TAX_TX_INCLUDE }>

function transferGroupId(tx: TxWithAsset): string | null {
  return tx.transferOut?.id ?? tx.transferIn?.id ?? null
}

function swapGroupId(tx: TxWithAsset): string | null {
  return tx.swapOut?.id ?? tx.swapIn?.id ?? null
}

// The engine computes only in EUR. A foreign-currency price is discarded (no
// FX conversion in V1) and — like missing prices — replaced via daily-price backfill.
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
    // Price missing or not in EUR → backfill; the fee is then not usable
    return { tx, priceEur: null, feeEur: null, needsBackfill: true }
  })

  for (const [assetSymbol, count] of foreignCurrency) {
    warnings.push({ code: TaxWarningCode.FOREIGN_CURRENCY_PRICE_IGNORED, assetSymbol, count })
  }

  // Only backfill types whose price is tax-relevant
  // (STAKING_REWARD: DE needs the inflow value as income + cost basis).
  // Linked transfer deposits need no price — their basis comes from
  // the moved-over slices (saves CoinGecko budget).
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
      swapGroupId: swapGroupId(p.tx),
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

// Load a portfolio's transactions + enrich them with EUR (backfill) prices.
// Shared with the PnL calculation (computeHoldingsCostBasis).
export async function loadEnrichedTransactions(
  userId: string,
  portfolioId?: string,
): Promise<EngineTx[]> {
  const pid = await resolvePortfolioId(userId, portfolioId)
  const txs = await prisma.transaction.findMany({
    where: { source: { userId, portfolioId: pid } },
    include: TAX_TX_INCLUDE,
    orderBy: { timestamp: 'asc' },
  })
  const { engineTxs } = await enrichTransactions(txs)
  return engineTxs
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

  // Sources with balances but no transaction history — no tax can be computed
  // for these; the report flags them explicitly
  const uncovered = await prisma.portfolioSource.findMany({
    where: { userId, portfolioId: pid, holdings: { some: {} }, transactions: { none: {} } },
    select: { id: true, label: true, type: true },
    orderBy: { createdAt: 'asc' },
  })

  // Wallets with reward-only imports do not count as "covered" —
  // their buys/sells are still missing (a hint instead of false confidence)
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
