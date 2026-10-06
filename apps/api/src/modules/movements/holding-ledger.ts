import { Prisma, type HoldingAccountType, type MovementOrigin } from '@prisma/client'
import { getLatestPrices } from '../../coingecko/price.service'

// Every holding write goes through here so the statement (HoldingMovement) stays
// complete: the sum of all deltas per (source, asset, account type) equals the
// current holding quantity. Only changes are booked; an unchanged re-sync books nothing.

export interface HoldingRow {
  assetId: string
  accountType: HoldingAccountType
  quantity: Prisma.Decimal
}

interface BookOptions {
  origin: MovementOrigin
  syncRunId?: string
}

const key = (assetId: string, accountType: HoldingAccountType) => `${assetId}|${accountType}`

// Rate at booking time = latest known price (null when none exists yet).
async function pricedMovements(
  sourceId: string,
  changes: Array<{ assetId: string; accountType: HoldingAccountType; before: Prisma.Decimal; after: Prisma.Decimal }>,
  kind: 'OPENING' | 'CHANGE',
  opts: BookOptions,
): Promise<Prisma.HoldingMovementCreateManyInput[]> {
  const prices = await getLatestPrices([...new Set(changes.map((c) => c.assetId))])
  return changes.map((c) => {
    const price = prices.get(c.assetId)
    return {
      sourceId,
      assetId: c.assetId,
      accountType: c.accountType,
      kind,
      origin: opts.origin,
      quantityBefore: c.before,
      quantityAfter: c.after,
      delta: c.after.sub(c.before),
      priceEur: price?.priceEur ?? null,
      priceUsd: price?.priceUsd ?? null,
      syncRunId: opts.syncRunId ?? null,
    }
  })
}

// Replace a source's holdings with `rows` and book the difference. The first
// SYNC/IMPORT write of a source is its opening balance; manual edits are always
// changes (the user is recording them one by one).
export async function replaceSourceHoldings(
  db: Prisma.TransactionClient,
  sourceId: string,
  rows: HoldingRow[],
  opts: BookOptions,
): Promise<void> {
  const source = await db.portfolioSource.findUniqueOrThrow({
    where: { id: sourceId },
    select: { ledgerOpenedAt: true },
  })
  const existing = await db.holding.findMany({ where: { sourceId } })

  const before = new Map(existing.map((h) => [key(h.assetId, h.accountType), h]))
  const after = new Map(rows.map((r) => [key(r.assetId, r.accountType), r]))
  const zero = new Prisma.Decimal(0)
  const changes = [...new Set([...before.keys(), ...after.keys()])].flatMap((k) => {
    const b = before.get(k)
    const a = after.get(k)
    const q0 = b?.quantity ?? zero
    const q1 = a?.quantity ?? zero
    if (q0.equals(q1)) return []
    const ref = (a ?? b)!
    return [{ assetId: ref.assetId, accountType: ref.accountType, before: q0, after: q1 }]
  })

  await db.holding.deleteMany({ where: { sourceId } })
  if (rows.length > 0) {
    await db.holding.createMany({
      data: rows.map((r) => ({ sourceId, assetId: r.assetId, accountType: r.accountType, quantity: r.quantity })),
    })
  }

  const opening = source.ledgerOpenedAt === null && opts.origin !== 'MANUAL'
  if (changes.length > 0) {
    await db.holdingMovement.createMany({
      data: await pricedMovements(sourceId, changes, opening ? 'OPENING' : 'CHANGE', opts),
    })
  }
  if (source.ledgerOpenedAt === null) {
    await db.portfolioSource.update({ where: { id: sourceId }, data: { ledgerOpenedAt: new Date() } })
  }
}

// Book a single manual holding edit (create: before 0, delete: after 0).
export async function bookManualChange(
  db: Prisma.TransactionClient,
  sourceId: string,
  change: { assetId: string; accountType: HoldingAccountType; before: Prisma.Decimal; after: Prisma.Decimal },
): Promise<void> {
  if (change.before.equals(change.after)) return
  await db.holdingMovement.createMany({
    data: await pricedMovements(sourceId, [change], 'CHANGE', { origin: 'MANUAL' }),
  })
  await db.portfolioSource.updateMany({
    where: { id: sourceId, ledgerOpenedAt: null },
    data: { ledgerOpenedAt: new Date() },
  })
}
