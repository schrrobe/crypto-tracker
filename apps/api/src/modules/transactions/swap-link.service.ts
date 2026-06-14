import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'

// As with transfers: exchange CSVs often have day-level granularity — both legs
// may be up to 24 h apart.
const TIMESTAMP_TOLERANCE_MS = 24 * 60 * 60 * 1000

async function getOwnedTx(userId: string, txId: string) {
  const tx = await prisma.transaction.findFirst({
    where: { id: txId, source: { userId } },
    include: { swapOut: true, swapIn: true, source: { select: { portfolioId: true } } },
  })
  if (!tx) throw AppError.notFound('Transaktion nicht gefunden')
  return tx
}

// Links a SELL (Asset A) with a BUY (Asset B) into a crypto-to-crypto swap.
// :id may be either leg — the direction follows from the types.
export async function linkSwap(userId: string, txId: string, counterpartId: string): Promise<void> {
  const a = await getOwnedTx(userId, txId)
  const b = await getOwnedTx(userId, counterpartId)

  const types = [a.type, b.type].sort().join('+')
  if (types !== 'BUY+SELL') {
    throw AppError.badRequest(
      'SWAP_LINK_TYPES_INVALID',
      'Ein Tausch verknüpft genau einen Verkauf (Asset A) mit einem Kauf (Asset B)',
    )
  }
  const sell = a.type === 'SELL' ? a : b
  const buy = a.type === 'BUY' ? a : b

  if (a.source.portfolioId !== b.source.portfolioId) {
    throw AppError.badRequest(
      'SWAP_LINK_PORTFOLIO_MISMATCH',
      'Beide Seiten müssen zum selben Portfolio gehören',
    )
  }
  if (sell.assetId === buy.assetId) {
    throw AppError.badRequest('SWAP_LINK_SAME_ASSET', 'Ein Tausch verknüpft zwei verschiedene Assets')
  }
  if (Math.abs(sell.timestamp.getTime() - buy.timestamp.getTime()) > TIMESTAMP_TOLERANCE_MS) {
    throw AppError.badRequest('SWAP_LINK_TIMESTAMP_INVALID', 'Verkauf und Kauf liegen zu weit auseinander')
  }
  for (const tx of [sell, buy]) {
    if (tx.swapOut || tx.swapIn) {
      throw AppError.conflict('SWAP_LINK_ALREADY_LINKED', 'Eine der Transaktionen ist bereits verknüpft')
    }
  }

  try {
    await prisma.swapLink.create({ data: { sellTxId: sell.id, buyTxId: buy.id } })
  } catch (error) {
    // Race: two parallel links of the same transaction slip past the check above
    // and collide on the unique index → clean 409 instead of 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw AppError.conflict('SWAP_LINK_ALREADY_LINKED', 'Eine der Transaktionen ist bereits verknüpft')
    }
    throw error
  }
}

export async function unlinkSwap(userId: string, txId: string): Promise<void> {
  const tx = await getOwnedTx(userId, txId)
  const link = tx.swapOut ?? tx.swapIn
  if (!link) throw AppError.notFound('Tausch-Verknüpfung nicht gefunden')
  await prisma.swapLink.delete({ where: { id: link.id } })
}
