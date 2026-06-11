import { Prisma, type TxType } from '@prisma/client'

// Verdichtet Transaktionen zu Netto-Beständen: BUY/DEPOSIT zählen positiv,
// SELL/WITHDRAWAL negativ, TRANSFER/OTHER neutral. Nur positive Salden werden Holdings.
// Gemeinsame Logik für CSV-Transaktions-Importe und manuelle Transaktionen.
export function computeNetBalances(
  txs: Array<{ assetId: string; type: TxType; quantity: Prisma.Decimal }>,
): Array<{ assetId: string; quantity: Prisma.Decimal }> {
  const ZERO = new Prisma.Decimal(0)
  const net = new Map<string, Prisma.Decimal>()
  for (const tx of txs) {
    const sign =
      tx.type === 'BUY' || tx.type === 'DEPOSIT'
        ? 1
        : tx.type === 'SELL' || tx.type === 'WITHDRAWAL'
          ? -1
          : 0
    if (sign === 0) continue
    net.set(tx.assetId, (net.get(tx.assetId) ?? ZERO).add(tx.quantity.mul(sign)))
  }
  return [...net.entries()]
    .filter(([, quantity]) => quantity.gt(0))
    .map(([assetId, quantity]) => ({ assetId, quantity }))
}
