import { Prisma } from '@prisma/client'
import type {
  CreateTransactionInput,
  TransactionDto,
  UpdateTransactionInput,
} from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { refreshPrices } from '../../coingecko/price.service'
import { computeNetBalances } from './tx-net-balance'
import { resolvePortfolioId, resolvePortfolioIdForWrite } from '../portfolios/portfolios.service'

// Reserved label of the single auto-managed MANUAL source that backs manual
// transactions per portfolio. A partial unique index
// (PortfolioSource_manual_tx_bucket_key) guarantees there is at most one per
// portfolio. Exported so other modules can recognise / exclude this bucket.
export const MANUAL_TX_SOURCE_LABEL = 'Manuelle Transaktionen'

// Includes for DTO mapping: the counterpart of the transfer link incl. its source
const TX_INCLUDE = {
  asset: true,
  source: true,
  transferOut: { include: { depositTx: { include: { source: true } } } },
  transferIn: { include: { withdrawalTx: { include: { source: true } } } },
  swapOut: { include: { buyTx: { include: { source: true, asset: true } } } },
  swapIn: { include: { sellTx: { include: { source: true, asset: true } } } },
} satisfies Prisma.TransactionInclude

type TxWithRelations = Prisma.TransactionGetPayload<{ include: typeof TX_INCLUDE }>

function toTransactionDto(tx: TxWithRelations): TransactionDto {
  const transferLink = tx.transferOut
    ? {
        id: tx.transferOut.id,
        counterpartTxId: tx.transferOut.depositTx.id,
        counterpartSourceLabel: tx.transferOut.depositTx.source.label,
        direction: 'OUT' as const,
      }
    : tx.transferIn
      ? {
          id: tx.transferIn.id,
          counterpartTxId: tx.transferIn.withdrawalTx.id,
          counterpartSourceLabel: tx.transferIn.withdrawalTx.source.label,
          direction: 'IN' as const,
        }
      : null
  const swapLink = tx.swapOut
    ? {
        id: tx.swapOut.id,
        counterpartTxId: tx.swapOut.buyTx.id,
        counterpartSourceLabel: tx.swapOut.buyTx.source.label,
        counterpartAssetSymbol: tx.swapOut.buyTx.asset.symbol,
        direction: 'OUT' as const,
      }
    : tx.swapIn
      ? {
          id: tx.swapIn.id,
          counterpartTxId: tx.swapIn.sellTx.id,
          counterpartSourceLabel: tx.swapIn.sellTx.source.label,
          counterpartAssetSymbol: tx.swapIn.sellTx.asset.symbol,
          direction: 'IN' as const,
        }
      : null
  return {
    id: tx.id,
    sourceId: tx.sourceId,
    sourceLabel: tx.source.label,
    // imported transactions belong to the CSV import — only manual ones are editable
    editable: tx.source.type === 'MANUAL',
    asset: {
      id: tx.asset.id,
      symbol: tx.asset.symbol,
      name: tx.asset.name,
      coingeckoId: tx.asset.coingeckoId,
      iconUrl: tx.asset.iconUrl,
    },
    type: tx.type,
    quantity: tx.quantity.toString(),
    pricePerUnit: tx.pricePerUnit?.toString() ?? null,
    feeAmount: tx.feeAmount?.toString() ?? null,
    currency: tx.currency,
    timestamp: tx.timestamp.toISOString(),
    transferLink,
    swapLink,
  }
}

// Exactly one automatically managed MANUAL source per portfolio for manual
// transactions. Detected primarily via existing transactions (the label can be
// renamed via PATCH /sources), secondarily via the default label, otherwise created anew.
async function getOrCreateManualTxSource(userId: string, portfolioId: string) {
  const withTx = await prisma.portfolioSource.findFirst({
    where: { userId, portfolioId, type: 'MANUAL', transactions: { some: {} } },
  })
  if (withTx) return withTx

  const byLabel = await prisma.portfolioSource.findFirst({
    where: { userId, portfolioId, type: 'MANUAL', label: MANUAL_TX_SOURCE_LABEL },
  })
  if (byLabel) return byLabel

  try {
    return await prisma.portfolioSource.create({
      data: { userId, portfolioId, type: 'MANUAL', provider: 'MANUAL', label: MANUAL_TX_SOURCE_LABEL },
    })
  } catch (error) {
    // Race: two parallel first transactions both pass the checks above and collide
    // on the partial unique index → re-fetch the winner instead of failing (500).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.portfolioSource.findFirst({
        where: { userId, portfolioId, type: 'MANUAL', label: MANUAL_TX_SOURCE_LABEL },
      })
      if (existing) return existing
    }
    throw error
  }
}

// Re-derive the source's balances from its transactions (same net rule as the CSV import).
// Serialized per source via a transaction-scoped advisory lock: two concurrent
// transaction mutations on the same source would otherwise both deleteMany +
// createMany the holdings and collide on the (sourceId,assetId,accountType) unique
// index (P2002 → 500). The lock makes the loser wait, then recompute over the
// committed tx set. Reading the transactions INSIDE the lock keeps the snapshot consistent.
async function recomputeHoldings(sourceId: string): Promise<void> {
  const assetIds = await prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sourceId}))`
    const txs = await db.transaction.findMany({
      where: { sourceId },
      select: {
        assetId: true,
        type: true,
        quantity: true,
        feeAmount: true,
        currency: true,
        asset: { select: { symbol: true } },
      },
    })
    const { holdings } = computeNetBalances(
      txs.map((t) => ({
        assetId: t.assetId,
        type: t.type,
        quantity: t.quantity,
        fee: t.feeAmount,
        // Only subtract when the fee currency is explicitly the asset itself; the
        // fee currency is otherwise unknown, and assuming "asset" would wrongly
        // subtract fiat fees.
        feeInAsset: !!t.feeAmount && !!t.currency && t.currency === t.asset.symbol,
      })),
    )
    await db.holding.deleteMany({ where: { sourceId } })
    if (holdings.length > 0) {
      await db.holding.createMany({
        data: holdings.map((h) => ({ sourceId, assetId: h.assetId, quantity: h.quantity })),
      })
    }
    return holdings.map((h) => h.assetId)
  })
  await refreshPrices(assetIds)
}

export async function listTransactions(
  userId: string,
  query: { year?: number; assetId?: string; sourceId?: string; portfolioId?: string },
): Promise<TransactionDto[]> {
  const pid = await resolvePortfolioId(userId, query.portfolioId)
  const where: Prisma.TransactionWhereInput = { source: { userId, portfolioId: pid } }
  if (query.assetId) where.assetId = query.assetId
  // Ownership is already enforced by the source.userId filter — a foreign sourceId returns empty
  if (query.sourceId) where.sourceId = query.sourceId
  if (query.year) {
    where.timestamp = {
      gte: new Date(Date.UTC(query.year, 0, 1)),
      lt: new Date(Date.UTC(query.year + 1, 0, 1)),
    }
  }
  const txs = await prisma.transaction.findMany({
    where,
    include: TX_INCLUDE,
    orderBy: { timestamp: 'desc' },
  })
  return txs.map(toTransactionDto)
}

export async function createTransaction(
  userId: string,
  input: CreateTransactionInput,
): Promise<TransactionDto> {
  const asset = await prisma.asset.findUnique({ where: { id: input.assetId } })
  if (!asset) throw AppError.notFound('Asset nicht gefunden')

  const portfolioId = await resolvePortfolioIdForWrite(userId, input.portfolioId)
  const source = await getOrCreateManualTxSource(userId, portfolioId)
  const tx = await prisma.transaction.create({
    data: {
      sourceId: source.id,
      assetId: input.assetId,
      type: input.type,
      quantity: new Prisma.Decimal(input.quantity),
      pricePerUnit: input.pricePerUnit ? new Prisma.Decimal(input.pricePerUnit) : null,
      feeAmount: input.feeAmount ? new Prisma.Decimal(input.feeAmount) : null,
      currency: input.currency ?? null,
      timestamp: new Date(input.timestamp),
    },
    include: TX_INCLUDE,
  })
  await recomputeHoldings(source.id)
  return toTransactionDto(tx)
}

// Foreign and imported transactions → 404 (ownership convention, do not reveal existence)
async function getOwnedManualTransaction(userId: string, txId: string) {
  const tx = await prisma.transaction.findFirst({
    where: { id: txId, source: { userId } },
    include: { source: true, transferOut: true, transferIn: true, swapOut: true, swapIn: true },
  })
  if (!tx || tx.source.type !== 'MANUAL') throw AppError.notFound('Transaktion nicht gefunden')
  return tx
}

export async function updateTransaction(
  userId: string,
  txId: string,
  input: UpdateTransactionInput,
): Promise<TransactionDto> {
  const existing = await getOwnedManualTransaction(userId, txId)

  // Linked transfer legs must not retroactively break the link invariants
  // (type/asset/quantity/time) — unlink first, then edit
  const touchesLinkInvariants =
    input.type !== undefined ||
    input.assetId !== undefined ||
    input.quantity !== undefined ||
    input.timestamp !== undefined
  if ((existing.transferOut || existing.transferIn) && touchesLinkInvariants) {
    throw AppError.conflict(
      'TRANSFER_LINKED_TX_IMMUTABLE',
      'Diese Transaktion ist als Transfer verknüpft — bitte zuerst die Verknüpfung lösen',
    )
  }
  if ((existing.swapOut || existing.swapIn) && touchesLinkInvariants) {
    throw AppError.conflict(
      'SWAP_LINKED_TX_IMMUTABLE',
      'Diese Transaktion ist als Tausch verknüpft — bitte zuerst die Verknüpfung lösen',
    )
  }

  if (input.assetId) {
    const asset = await prisma.asset.findUnique({ where: { id: input.assetId } })
    if (!asset) throw AppError.notFound('Asset nicht gefunden')
  }

  const tx = await prisma.transaction.update({
    where: { id: existing.id },
    data: {
      assetId: input.assetId,
      type: input.type,
      quantity: input.quantity ? new Prisma.Decimal(input.quantity) : undefined,
      pricePerUnit: input.pricePerUnit ? new Prisma.Decimal(input.pricePerUnit) : undefined,
      feeAmount: input.feeAmount ? new Prisma.Decimal(input.feeAmount) : undefined,
      currency: input.currency,
      timestamp: input.timestamp ? new Date(input.timestamp) : undefined,
    },
    include: TX_INCLUDE,
  })
  await recomputeHoldings(existing.sourceId)
  return toTransactionDto(tx)
}

export async function deleteTransaction(userId: string, txId: string): Promise<void> {
  const existing = await getOwnedManualTransaction(userId, txId)
  await prisma.transaction.delete({ where: { id: existing.id } })

  // When the auto-managed bucket loses its last transaction, drop it: keeping an
  // empty phantom source would block portfolio deletion (sourceCount > 0) and
  // count against the free source limit. Cascade clears its (already empty) holdings.
  const remaining = await prisma.transaction.count({ where: { sourceId: existing.sourceId } })
  // Only auto-clean the auto-managed manual-tx bucket. A user-created MANUAL
  // source (e.g. a renamed/legacy bucket) must never be deleted out from under
  // the user just because its last transaction was removed.
  if (remaining === 0 && existing.source.label === MANUAL_TX_SOURCE_LABEL) {
    await prisma.portfolioSource.delete({ where: { id: existing.sourceId } })
    return
  }
  await recomputeHoldings(existing.sourceId)
}
