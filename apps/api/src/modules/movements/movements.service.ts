import { Prisma, type HoldingAccountType, type MovementKind, type MovementOrigin } from '@prisma/client'
import {
  movementHistoryDaysFor,
  type MovementGroupDto,
  type MovementsQuery,
  type MovementsResponseDto,
} from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { getPlan } from '../../middleware/plan.middleware'
import { getOwnedSource } from '../sources/sources.service'
import { resolvePortfolioId } from '../portfolios/portfolios.service'

interface GroupRow {
  day: string
  sourceId: string
  assetId: string
  accountType: HoldingAccountType
  kind: MovementKind
  origin: MovementOrigin
  delta: Prisma.Decimal
  quantityAfter: Prisma.Decimal
  valueEur: Prisma.Decimal | null
  valueUsd: Prisma.Decimal | null
  count: number
  lastAt: Date
}

// Statement lines: movements netted per day (in the viewer's time zone), source,
// asset, account type, kind and origin. Value = Σ delta × booking-time rate, null
// as soon as one movement of the line had no rate (a partial sum would understate).
export async function listMovementGroups(userId: string, query: MovementsQuery): Promise<MovementsResponseDto> {
  const pid = await resolvePortfolioId(userId, query.portfolioId)
  if (query.sourceId) await getOwnedSource(userId, query.sourceId)

  const historyDays = movementHistoryDaysFor(await getPlan(userId))
  const since = new Date(Date.now() - historyDays * 24 * 3600 * 1000)

  const filters: Prisma.Sql[] = [
    Prisma.sql`s."userId" = ${userId}`,
    Prisma.sql`s."portfolioId" = ${pid}`,
    Prisma.sql`m."at" >= ${since}`,
  ]
  if (query.sourceId) filters.push(Prisma.sql`m."sourceId" = ${query.sourceId}`)
  if (query.assetId) filters.push(Prisma.sql`m."assetId" = ${query.assetId}`)
  if (!query.includeUnpriced) filters.push(Prisma.sql`a."coingeckoId" IS NOT NULL`)

  // limit + 1 to detect a further page without a second count query
  const rows = await prisma.$queryRaw<GroupRow[]>`
    SELECT
      to_char(m."at" AT TIME ZONE 'UTC' AT TIME ZONE ${query.tz}, 'YYYY-MM-DD') AS "day",
      m."sourceId", m."assetId", m."accountType", m."kind", m."origin",
      SUM(m."delta") AS "delta",
      (ARRAY_AGG(m."quantityAfter" ORDER BY m."at" DESC, m."id" DESC))[1] AS "quantityAfter",
      CASE WHEN COUNT(m."priceEur") = COUNT(*) THEN SUM(m."delta" * m."priceEur") END AS "valueEur",
      CASE WHEN COUNT(m."priceUsd") = COUNT(*) THEN SUM(m."delta" * m."priceUsd") END AS "valueUsd",
      COUNT(*)::int AS "count",
      MAX(m."at") AS "lastAt"
    FROM "HoldingMovement" m
    JOIN "PortfolioSource" s ON s."id" = m."sourceId"
    JOIN "Asset" a ON a."id" = m."assetId"
    WHERE ${Prisma.join(filters, ' AND ')}
    GROUP BY 1, 2, 3, 4, 5, 6
    ORDER BY MAX(m."at") DESC, 2, 3
    LIMIT ${query.limit + 1} OFFSET ${query.offset}
  `
  const page = rows.slice(0, query.limit)

  const [sources, assets] = await Promise.all([
    prisma.portfolioSource.findMany({
      where: { id: { in: [...new Set(page.map((r) => r.sourceId))] } },
      select: { id: true, label: true, type: true },
    }),
    prisma.asset.findMany({ where: { id: { in: [...new Set(page.map((r) => r.assetId))] } } }),
  ])
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const assetById = new Map(assets.map((a) => [a.id, a]))

  const groups: MovementGroupDto[] = page.map((r) => {
    const source = sourceById.get(r.sourceId)!
    const asset = assetById.get(r.assetId)!
    return {
      day: r.day,
      sourceId: r.sourceId,
      sourceLabel: source.label,
      sourceType: source.type,
      asset: {
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        coingeckoId: asset.coingeckoId,
        iconUrl: asset.iconUrl,
      },
      accountType: r.accountType,
      kind: r.kind,
      origin: r.origin,
      delta: new Prisma.Decimal(r.delta).toString(),
      quantityAfter: new Prisma.Decimal(r.quantityAfter).toString(),
      valueEur: r.valueEur === null ? null : new Prisma.Decimal(r.valueEur).toFixed(2),
      valueUsd: r.valueUsd === null ? null : new Prisma.Decimal(r.valueUsd).toFixed(2),
      count: r.count,
      lastAt: r.lastAt.toISOString(),
    }
  })

  return { groups, historyDays, hasMore: rows.length > query.limit }
}
