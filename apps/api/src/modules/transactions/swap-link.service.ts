import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'

// Wie beim Transfer: Exchange-CSVs haben oft Tagesgranularität — beide Legs
// dürfen bis zu 24 h auseinanderliegen.
const TIMESTAMP_TOLERANCE_MS = 24 * 60 * 60 * 1000

async function getOwnedTx(userId: string, txId: string) {
  const tx = await prisma.transaction.findFirst({
    where: { id: txId, source: { userId } },
    include: { swapOut: true, swapIn: true, source: { select: { portfolioId: true } } },
  })
  if (!tx) throw AppError.notFound('Transaktion nicht gefunden')
  return tx
}

// Verknüpft eine SELL (Asset A) mit einer BUY (Asset B) zu einem Krypto-zu-Krypto-
// Tausch. :id darf beide Seiten sein — die Richtung ergibt sich aus den Typen.
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

  await prisma.swapLink.create({ data: { sellTxId: sell.id, buyTxId: buy.id } })
}

export async function unlinkSwap(userId: string, txId: string): Promise<void> {
  const tx = await getOwnedTx(userId, txId)
  const link = tx.swapOut ?? tx.swapIn
  if (!link) throw AppError.notFound('Tausch-Verknüpfung nicht gefunden')
  await prisma.swapLink.delete({ where: { id: link.id } })
}
