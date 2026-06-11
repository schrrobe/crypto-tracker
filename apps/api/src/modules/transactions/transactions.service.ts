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

const MANUAL_TX_SOURCE_LABEL = 'Manuelle Transaktionen'

type TxWithRelations = Prisma.TransactionGetPayload<{ include: { asset: true; source: true } }>

function toTransactionDto(tx: TxWithRelations): TransactionDto {
  return {
    id: tx.id,
    sourceId: tx.sourceId,
    sourceLabel: tx.source.label,
    // importierte Transaktionen gehören dem CSV-Import — nur manuelle sind änderbar
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
  }
}

// Genau eine automatisch verwaltete MANUAL-Quelle pro User für manuelle Transaktionen.
// Erkennung primär über vorhandene Transaktionen (Label ist über PATCH /sources umbenennbar),
// sekundär über das Standard-Label, sonst neu anlegen.
async function getOrCreateManualTxSource(userId: string) {
  const withTx = await prisma.portfolioSource.findFirst({
    where: { userId, type: 'MANUAL', transactions: { some: {} } },
  })
  if (withTx) return withTx

  const byLabel = await prisma.portfolioSource.findFirst({
    where: { userId, type: 'MANUAL', label: MANUAL_TX_SOURCE_LABEL },
  })
  if (byLabel) return byLabel

  return prisma.portfolioSource.create({
    data: { userId, type: 'MANUAL', provider: 'MANUAL', label: MANUAL_TX_SOURCE_LABEL },
  })
}

// Bestände der Quelle aus den Transaktionen neu ableiten (gleiche Netto-Regel wie CSV-Import)
async function recomputeHoldings(sourceId: string): Promise<void> {
  const txs = await prisma.transaction.findMany({
    where: { sourceId },
    select: { assetId: true, type: true, quantity: true },
  })
  const holdings = computeNetBalances(txs)
  await prisma.$transaction([
    prisma.holding.deleteMany({ where: { sourceId } }),
    prisma.holding.createMany({
      data: holdings.map((h) => ({ sourceId, assetId: h.assetId, quantity: h.quantity })),
    }),
  ])
  await refreshPrices(holdings.map((h) => h.assetId))
}

export async function listTransactions(
  userId: string,
  query: { year?: number; assetId?: string },
): Promise<TransactionDto[]> {
  const where: Prisma.TransactionWhereInput = { source: { userId } }
  if (query.assetId) where.assetId = query.assetId
  if (query.year) {
    where.timestamp = {
      gte: new Date(Date.UTC(query.year, 0, 1)),
      lt: new Date(Date.UTC(query.year + 1, 0, 1)),
    }
  }
  const txs = await prisma.transaction.findMany({
    where,
    include: { asset: true, source: true },
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

  const source = await getOrCreateManualTxSource(userId)
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
    include: { asset: true, source: true },
  })
  await recomputeHoldings(source.id)
  return toTransactionDto(tx)
}

// Fremde und importierte Transaktionen → 404 (Ownership-Konvention, keine Existenz preisgeben)
async function getOwnedManualTransaction(userId: string, txId: string) {
  const tx = await prisma.transaction.findFirst({
    where: { id: txId, source: { userId } },
    include: { source: true },
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
    include: { asset: true, source: true },
  })
  await recomputeHoldings(existing.sourceId)
  return toTransactionDto(tx)
}

export async function deleteTransaction(userId: string, txId: string): Promise<void> {
  const existing = await getOwnedManualTransaction(userId, txId)
  await prisma.transaction.delete({ where: { id: existing.id } })
  await recomputeHoldings(existing.sourceId)
}
