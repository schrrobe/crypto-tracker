import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import type {
  AdminAssetsDto,
  AdminCommissionDto,
  AdminGrowthPointDto,
  AdminImportsDto,
  AdminOverviewDto,
  AdminPriceCacheDto,
  AdminSyncHealthDto,
  AdminUserDetailDto,
  AdminUserListDto,
  AdminUpdatePlanInput,
} from '@crypto-tracker/shared'
import { getReferralOverview } from '../referral/referral.service'
import { deleteAccount } from '../auth/auth.service'

// Pro price proxy for MRR (no live Stripe revenue query). Adjust if pricing changes.
const PRO_PRICE_CENTS = 999
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS)
}

// --- Stats ------------------------------------------------------------------

export async function getOverview(): Promise<AdminOverviewDto> {
  const now = new Date()
  const [totalUsers, proUsers, activeSubscriptions, newUsers7d, newUsers30d, owed, paid, referrers, invited] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { plan: 'PRO' } }),
      prisma.user.count({ where: { plan: 'PRO', planUntil: { gt: now } } }),
      prisma.user.count({ where: { createdAt: { gte: daysAgo(7) } } }),
      prisma.user.count({ where: { createdAt: { gte: daysAgo(30) } } }),
      prisma.referralCommission.aggregate({ _sum: { amountCents: true }, where: { payoutId: null, voidedAt: null } }),
      prisma.referralCommission.aggregate({ _sum: { amountCents: true }, where: { payoutId: { not: null }, voidedAt: null } }),
      prisma.referralCommission.findMany({ where: { voidedAt: null }, select: { referrerId: true }, distinct: ['referrerId'] }),
      prisma.user.count({ where: { referredById: { not: null } } }),
    ])
  const freeUsers = totalUsers - proUsers
  return {
    totalUsers,
    proUsers,
    freeUsers,
    proRatePct: totalUsers === 0 ? 0 : Math.round((proUsers / totalUsers) * 1000) / 10,
    newUsers7d,
    newUsers30d,
    activeSubscriptions,
    mrrProxyCents: activeSubscriptions * PRO_PRICE_CENTS,
    referral: {
      owedCents: owed._sum.amountCents ?? 0,
      paidCents: paid._sum.amountCents ?? 0,
      activeReferrers: referrers.length,
      invitedUsers: invited,
    },
  }
}

export async function getGrowth(days: number): Promise<AdminGrowthPointDto[]> {
  const cutoff = daysAgo(days)
  const rows = await prisma.$queryRaw<{ date: string; signups: number }[]>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') as date, count(*)::int as signups
    FROM "User" WHERE "createdAt" >= ${cutoff}
    GROUP BY 1 ORDER BY 1`
  const before = await prisma.user.count({ where: { createdAt: { lt: cutoff } } })
  let cumulative = before
  return rows.map((r) => {
    cumulative += r.signups
    return { date: r.date, signups: r.signups, cumulative }
  })
}

export async function getSyncHealth(days: number): Promise<AdminSyncHealthDto> {
  const cutoff = daysAgo(days)
  const byStatus = await prisma.syncRun.groupBy({
    by: ['status'],
    where: { startedAt: { gte: cutoff } },
    _count: { _all: true },
  })
  const errorCodes = await prisma.syncRun.groupBy({
    by: ['errorCode'],
    where: { startedAt: { gte: cutoff }, status: 'ERROR', errorCode: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { errorCode: 'desc' } },
    take: 10,
  })
  const byProvider = await prisma.$queryRaw<{ provider: string | null; count: number }[]>`
    SELECT s.provider as provider, count(*)::int as count
    FROM "SyncRun" r JOIN "PortfolioSource" s ON s.id = r."sourceId"
    WHERE r."startedAt" >= ${cutoff}
    GROUP BY 1 ORDER BY 2 DESC`
  const statusCount = (s: 'SUCCESS' | 'ERROR') =>
    byStatus.find((b) => b.status === s)?._count._all ?? 0
  return {
    success: statusCount('SUCCESS'),
    error: statusCount('ERROR'),
    byProvider: byProvider.map((p) => ({ key: p.provider ?? 'UNKNOWN', count: p.count })),
    topErrorCodes: errorCodes.map((e) => ({ key: e.errorCode ?? 'UNKNOWN', count: e._count._all })),
  }
}

export async function getSourcesStats(): Promise<{ byType: { key: string; count: number }[]; byProvider: { key: string; count: number }[]; staleCount: number }> {
  const [byType, byProvider, staleCount] = await Promise.all([
    prisma.portfolioSource.groupBy({ by: ['type'], _count: { _all: true } }),
    prisma.portfolioSource.groupBy({ by: ['provider'], _count: { _all: true } }),
    prisma.portfolioSource.count({ where: { OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: daysAgo(1) } }] } }),
  ])
  return {
    byType: byType.map((t) => ({ key: t.type, count: t._count._all })),
    byProvider: byProvider.map((p) => ({ key: p.provider ?? 'UNKNOWN', count: p._count._all })),
    staleCount,
  }
}

export async function getImportsStats(): Promise<AdminImportsDto> {
  const byStatus = await prisma.csvImport.groupBy({ by: ['status'], _count: { _all: true } })
  const sums = await prisma.csvImport.aggregate({ _sum: { totalRows: true, importedRows: true } })
  const totalRows = sums._sum?.totalRows ?? 0
  const importedRows = sums._sum?.importedRows ?? 0
  return {
    byStatus: byStatus.map((s) => ({ key: s.status, count: s._count._all })),
    totalRows,
    importedRows,
    errorRows: Math.max(0, totalRows - importedRows),
  }
}

export async function getAssetsStats(): Promise<AdminAssetsDto> {
  const distinctAssets = (await prisma.holding.findMany({ select: { assetId: true }, distinct: ['assetId'] })).length
  const top = await prisma.holding.groupBy({
    by: ['assetId'],
    _count: { _all: true },
    orderBy: { _count: { assetId: 'desc' } },
    take: 10,
  })
  const assets = await prisma.asset.findMany({
    where: { id: { in: top.map((t) => t.assetId) } },
    select: { id: true, symbol: true },
  })
  const symbolById = new Map(assets.map((a) => [a.id, a.symbol]))
  const byAccountType = await prisma.holding.groupBy({ by: ['accountType'], _count: { _all: true } })
  return {
    distinctAssets,
    topAssets: top.map((t) => ({ key: symbolById.get(t.assetId) ?? t.assetId, count: t._count._all })),
    byAccountType: byAccountType.map((a) => ({ key: a.accountType, count: a._count._all })),
  }
}

export async function getTransactionsStats(
  days: number,
): Promise<{ perDay: { date: string; count: number }[]; byType: { key: string; count: number }[] }> {
  const cutoff = daysAgo(days)
  const perDay = await prisma.$queryRaw<{ date: string; count: number }[]>`
    SELECT to_char(date_trunc('day', "timestamp"), 'YYYY-MM-DD') as date, count(*)::int as count
    FROM "Transaction" WHERE "timestamp" >= ${cutoff}
    GROUP BY 1 ORDER BY 1`
  const byType = await prisma.transaction.groupBy({
    by: ['type'],
    where: { timestamp: { gte: cutoff } },
    _count: { _all: true },
  })
  return {
    perDay,
    byType: byType.map((t) => ({ key: t.type, count: t._count._all })),
  }
}

export async function getPriceCacheStats(): Promise<AdminPriceCacheDto> {
  const [agg, staleCount, historicalRows] = await Promise.all([
    prisma.assetPrice.aggregate({ _count: { _all: true }, _min: { fetchedAt: true }, _max: { fetchedAt: true } }),
    prisma.assetPrice.count({ where: { fetchedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } }),
    prisma.historicalAssetPrice.count(),
  ])
  return {
    cachedAssets: agg._count._all,
    oldestFetchedAt: agg._min.fetchedAt?.toISOString() ?? null,
    newestFetchedAt: agg._max.fetchedAt?.toISOString() ?? null,
    staleCount,
    historicalRows,
  }
}

// --- Users ------------------------------------------------------------------

export async function listUsers(query: {
  search?: string
  plan?: 'FREE' | 'PRO'
  page: number
  pageSize: number
}): Promise<AdminUserListDto> {
  const where = {
    ...(query.search ? { email: { contains: query.search, mode: 'insensitive' as const } } : {}),
    ...(query.plan ? { plan: query.plan } : {}),
  }
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        email: true,
        plan: true,
        planUntil: true,
        isAdmin: true,
        createdAt: true,
        referredBy: { select: { email: true } },
        _count: { select: { sources: true } },
      },
    }),
  ])
  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      plan: u.plan,
      planUntil: u.planUntil?.toISOString() ?? null,
      isAdmin: u.isAdmin,
      sourcesCount: u._count.sources,
      referredByEmail: u.referredBy?.email ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
  }
}

export async function getUserDetail(id: string): Promise<AdminUserDetailDto> {
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      plan: true,
      planUntil: true,
      isAdmin: true,
      createdAt: true,
      referredBy: { select: { email: true } },
      _count: { select: { sources: true, portfolios: true } },
    },
  })
  if (!u) throw AppError.notFound('User nicht gefunden')
  const [holdingsCount, activeSessions, overview] = await Promise.all([
    prisma.holding.count({ where: { source: { userId: id } } }),
    prisma.refreshToken.count({ where: { userId: id, expiresAt: { gt: new Date() } } }),
    getReferralOverview(id),
  ])
  return {
    id: u.id,
    email: u.email,
    plan: u.plan,
    planUntil: u.planUntil?.toISOString() ?? null,
    isAdmin: u.isAdmin,
    sourcesCount: u._count.sources,
    referredByEmail: u.referredBy?.email ?? null,
    createdAt: u.createdAt.toISOString(),
    portfoliosCount: u._count.portfolios,
    holdingsCount,
    invitedCount: overview.invitedCount,
    activeSessions,
    earnings: overview.earnings,
  }
}

export async function updateUserPlan(id: string, input: AdminUpdatePlanInput): Promise<void> {
  await prisma.user.update({
    where: { id },
    data: {
      plan: input.plan,
      planUntil: input.planUntil === undefined ? undefined : input.planUntil ? new Date(input.planUntil) : null,
    },
  })
}

export async function deleteUser(actingAdminId: string, id: string): Promise<void> {
  if (actingAdminId === id) throw AppError.badRequest('CANNOT_DELETE_SELF', 'Admin kann sich nicht selbst löschen')
  const target = await prisma.user.findUnique({ where: { id }, select: { isAdmin: true } })
  if (!target) throw AppError.notFound('User nicht gefunden')
  if (target.isAdmin) {
    const admins = await prisma.user.count({ where: { isAdmin: true } })
    if (admins <= 1) throw AppError.badRequest('CANNOT_DELETE_LAST_ADMIN', 'Letzter Admin kann nicht gelöscht werden')
  }
  await deleteAccount(id)
}

export async function revokeSessions(id: string): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({ where: { userId: id } })
  return count
}

// --- Referral admin ---------------------------------------------------------

export async function listCommissions(referrerId?: string): Promise<AdminCommissionDto[]> {
  const rows = await prisma.referralCommission.findMany({
    where: referrerId ? { referrerId } : {},
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { referrer: { select: { email: true } } },
  })
  return rows.map((c) => ({
    id: c.id,
    referrerEmail: c.referrer.email,
    referredUserId: c.referredUserId,
    amountCents: c.amountCents,
    currency: c.currency,
    payoutId: c.payoutId,
    voidedAt: c.voidedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  }))
}

export async function voidCommission(id: string): Promise<void> {
  const c = await prisma.referralCommission.findUnique({ where: { id }, select: { payoutId: true, voidedAt: true } })
  if (!c) throw AppError.notFound('Kommission nicht gefunden')
  if (c.payoutId) throw AppError.badRequest('ALREADY_PAID', 'Bereits ausgezahlte Kommission kann nicht storniert werden')
  await prisma.referralCommission.update({ where: { id }, data: { voidedAt: new Date() } })
}

export async function listPayoutHistory(): Promise<{ id: string; referrerEmail: string; amountCents: number; currency: string; createdAt: string }[]> {
  const rows = await prisma.payout.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { referrer: { select: { email: true } } },
  })
  return rows.map((p) => ({
    id: p.id,
    referrerEmail: p.referrer.email,
    amountCents: p.amountCents,
    currency: p.currency,
    createdAt: p.createdAt.toISOString(),
  }))
}
