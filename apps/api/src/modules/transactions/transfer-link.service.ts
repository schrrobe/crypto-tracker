import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'

// Toleranz: Exchange-CSVs haben oft nur Tagesgranularität; eine Einzahlung darf
// nominell bis zu 24 h vor der Auszahlung liegen, ohne dass das Paar abgelehnt wird
const TIMESTAMP_TOLERANCE_MS = 24 * 60 * 60 * 1000

async function getOwnedTx(userId: string, txId: string) {
  const tx = await prisma.transaction.findFirst({
    where: { id: txId, source: { userId } },
    include: { transferOut: true, transferIn: true, source: { select: { portfolioId: true } } },
  })
  if (!tx) throw AppError.notFound('Transaktion nicht gefunden')
  return tx
}

// Verknüpft eine WITHDRAWAL- mit einer DEPOSIT-Transaktion zu einem Transfer-Paar.
// :id darf beide Seiten sein — die Richtung ergibt sich aus den Typen.
// Auch importierte (CSV-)Transaktionen sind verlinkbar; `editable` gated nur Feld-Edits.
export async function linkTransfer(userId: string, txId: string, counterpartId: string): Promise<void> {
  const a = await getOwnedTx(userId, txId)
  const b = await getOwnedTx(userId, counterpartId)

  const types = [a.type, b.type].sort().join('+')
  if (types !== 'DEPOSIT+WITHDRAWAL') {
    throw AppError.badRequest(
      'TRANSFER_LINK_TYPES_INVALID',
      'Ein Transfer verknüpft genau eine Auszahlung mit einer Einzahlung',
    )
  }
  const withdrawal = a.type === 'WITHDRAWAL' ? a : b
  const deposit = a.type === 'DEPOSIT' ? a : b

  // Portfolios sind getrennte Steuersubjekte — ein Kostenbasis-Umzug über die
  // Grenze wäre steuerlich Schenkung/Veräußerung, kein Transfer
  if (a.source.portfolioId !== b.source.portfolioId) {
    throw AppError.badRequest(
      'TRANSFER_LINK_PORTFOLIO_MISMATCH',
      'Beide Seiten müssen zum selben Portfolio gehören',
    )
  }

  if (withdrawal.assetId !== deposit.assetId) {
    throw AppError.badRequest('TRANSFER_LINK_ASSET_MISMATCH', 'Beide Seiten müssen dasselbe Asset haben')
  }
  if (deposit.quantity.gt(withdrawal.quantity)) {
    throw AppError.badRequest(
      'TRANSFER_LINK_QUANTITY_INVALID',
      'Die Einzahlungsmenge darf die Auszahlungsmenge nicht übersteigen (Netzwerkgebühr)',
    )
  }
  if (deposit.timestamp.getTime() < withdrawal.timestamp.getTime() - TIMESTAMP_TOLERANCE_MS) {
    throw AppError.badRequest(
      'TRANSFER_LINK_TIMESTAMP_INVALID',
      'Die Einzahlung liegt zu weit vor der Auszahlung',
    )
  }
  for (const tx of [withdrawal, deposit]) {
    if (tx.transferOut || tx.transferIn) {
      throw AppError.conflict('TRANSFER_LINK_ALREADY_LINKED', 'Eine der Transaktionen ist bereits verknüpft')
    }
  }

  await prisma.transferLink.create({
    data: { withdrawalTxId: withdrawal.id, depositTxId: deposit.id },
  })
}

export async function unlinkTransfer(userId: string, txId: string): Promise<void> {
  const tx = await getOwnedTx(userId, txId)
  const link = tx.transferOut ?? tx.transferIn
  if (!link) throw AppError.notFound('Transfer-Verknüpfung nicht gefunden')
  await prisma.transferLink.delete({ where: { id: link.id } })
}
