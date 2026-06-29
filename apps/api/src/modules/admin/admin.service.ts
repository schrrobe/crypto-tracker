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
import { Prisma } from '@prisma/client'
import type { AdminAttentionDto, AdminChurnDto, AdminSourceDto } from '@crypto-tracker/shared'
import { earningsByCurrency, listPendingPayouts } from '../referral/referral.service'
import { deleteAccount } from '../auth/auth.service'
import { requestSync } from '../sync/sync.service'
import { toSyncRunDto } from '../sync/syncRun.mapper'
import { activeProCutoff } from '../../middleware/plan.middleware'
import { AuditAction, recordAudit, type AuditActor } from './audit.service'

// Pro price proxy for MRR (no live Stripe revenue query). Adjust if pricing changes.
const PRO_PRICE_CENTS = 999
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS)
}

// --- Stats ------------------------------------------------------------------

export async function getOverview(): Promise<AdminOverviewDto> {
  const now = new Date()
  const [
    totalUsers,
    proUsers,
    activeSubscriptions,
    newUsers7d,
    newUsers30d,
    prev7d,
    prev30d,
    activeSessions,
    owed,
    paid,
    referrers,
    invited,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { plan: 'PRO' } }),
    // Active subscription = PRO within the grace window (matches getPlan gating).
    prisma.user.count({ where: { plan: 'PRO', OR: [{ planUntil: null }, { planUntil: { gte: activeProCutoff() } }] } }),
    prisma.user.count({ where: { createdAt: { gte: daysAgo(7) } } }),
    prisma.user.count({ where: { createdAt: { gte: daysAgo(30) } } }),
    prisma.user.count({ where: { createdAt: { gte: daysAgo(14), lt: daysAgo(7) } } }),
    prisma.user.count({ where: { createdAt: { gte: daysAgo(60), lt: daysAgo(30) } } }),
    prisma.refreshToken.count({ where: { expiresAt: { gt: now } } }),
    prisma.referralCommission.groupBy({ by: ['currency'], _sum: { amountCents: true }, where: { status: { not: 'REVERSED' } } }),
    prisma.referralCommission.groupBy({ by: ['currency'], _sum: { amountCents: true }, where: { payoutId: { not: null }, status: { not: 'REVERSED' } } }),
    prisma.referralCommission.findMany({ where: { status: { not: 'REVERSED' } }, select: { referrerId: true }, distinct: ['referrerId'] }),
    prisma.user.count({ where: { referredById: { not: null } } }),
  ])
  const freeUsers = totalUsers - proUsers
  const paidByCurrency = new Map(paid.map((r) => [r.currency, r._sum.amountCents ?? 0]))
  const referralByCurrency = owed.map((r) => {
    const total = r._sum.amountCents ?? 0
    const paidCents = paidByCurrency.get(r.currency) ?? 0
    // Admin liability view: owedCents = all non-reversed not-yet-paid (clearing
    // not split out here); pendingCents tracked per-user in the referral overview.
    return { currency: r.currency, pendingCents: 0, owedCents: total - paidCents, paidCents }
  })
  return {
    totalUsers,
    proUsers,
    freeUsers,
    proRatePct: totalUsers === 0 ? 0 : Math.round((proUsers / totalUsers) * 1000) / 10,
    newUsers7d,
    newUsers30d,
    newUsers7dDeltaPct: deltaPct(newUsers7d, prev7d),
    newUsers30dDeltaPct: deltaPct(newUsers30d, prev30d),
    activeSessions,
    activeSubscriptions,
    mrrProxyCents: activeSubscriptions * PRO_PRICE_CENTS,
    referral: {
      byCurrency: referralByCurrency,
      activeReferrers: referrers.length,
      invitedUsers: invited,
    },
  }
}

// % change vs previous period; null when previous was 0 (no meaningful ratio).
function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

export async function getActivity(): Promise<import('@crypto-tracker/shared').AdminActivityDto> {
  const [signups, auditRows] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, email: true, plan: true, createdAt: true },
    }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
  ])
  return {
    recentSignups: signups.map((s) => ({
      id: s.id,
      email: s.email,
      plan: s.plan,
      createdAt: s.createdAt.toISOString(),
    })),
    recentAudit: auditRows.map((r) => ({
      id: r.id,
      actorEmail: r.actorEmail,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    })),
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
        suspendedAt: true,
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
      suspendedAt: u.suspendedAt?.toISOString() ?? null,
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
      suspendedAt: true,
      createdAt: true,
      referredBy: { select: { email: true } },
      _count: { select: { sources: true, portfolios: true } },
    },
  })
  if (!u) throw AppError.notFound('User nicht gefunden')
  // Compute earnings directly (no getReferralOverview — that one writes a
  // referralCode on read and loads full invited/commission lists).
  const [holdingsCount, activeSessions, invitedCount, earnings] = await Promise.all([
    prisma.holding.count({ where: { source: { userId: id } } }),
    prisma.refreshToken.count({ where: { userId: id, expiresAt: { gt: new Date() } } }),
    prisma.user.count({ where: { referredById: id } }),
    earningsByCurrency(id),
  ])
  return {
    id: u.id,
    email: u.email,
    plan: u.plan,
    planUntil: u.planUntil?.toISOString() ?? null,
    isAdmin: u.isAdmin,
    suspendedAt: u.suspendedAt?.toISOString() ?? null,
    sourcesCount: u._count.sources,
    referredByEmail: u.referredBy?.email ?? null,
    createdAt: u.createdAt.toISOString(),
    portfoliosCount: u._count.portfolios,
    holdingsCount,
    invitedCount,
    activeSessions,
    earnings,
  }
}

export async function updateUserPlan(actor: AuditActor, id: string, input: AdminUpdatePlanInput): Promise<void> {
  const before = await prisma.user.findUnique({ where: { id }, select: { plan: true } })
  await prisma.user.update({
    where: { id },
    data: {
      plan: input.plan,
      planUntil: input.planUntil === undefined ? undefined : input.planUntil ? new Date(input.planUntil) : null,
    },
  })
  await recordAudit({
    actor,
    action: AuditAction.USER_PLAN_CHANGED,
    targetType: 'USER',
    targetId: id,
    metadata: { from: before?.plan, to: input.plan, planUntil: input.planUntil ?? null },
  })
}

export async function deleteUser(actor: AuditActor, id: string): Promise<void> {
  if (actor.id === id) throw AppError.badRequest('CANNOT_DELETE_SELF', 'Admin kann sich nicht selbst löschen')
  const target = await prisma.user.findUnique({ where: { id }, select: { isAdmin: true, email: true } })
  if (!target) throw AppError.notFound('User nicht gefunden')
  if (target.isAdmin) {
    const admins = await prisma.user.count({ where: { isAdmin: true } })
    if (admins <= 1) throw AppError.badRequest('CANNOT_DELETE_LAST_ADMIN', 'Letzter Admin kann nicht gelöscht werden')
  }
  await deleteAccount(id)
  await recordAudit({
    actor,
    action: AuditAction.USER_DELETED,
    targetType: 'USER',
    targetId: id,
    metadata: { email: target.email },
  })
}

export async function setSuspended(actor: AuditActor, id: string, suspended: boolean): Promise<void> {
  const target = await prisma.user.findUnique({ where: { id }, select: { email: true } })
  if (!target) throw AppError.notFound('User nicht gefunden')
  await prisma.user.update({ where: { id }, data: { suspendedAt: suspended ? new Date() : null } })
  if (suspended) {
    // Force logout: drop refresh tokens so existing sessions die at access-token expiry.
    await prisma.refreshToken.deleteMany({ where: { userId: id } })
  }
  await recordAudit({
    actor,
    action: suspended ? AuditAction.USER_SUSPENDED : AuditAction.USER_UNSUSPENDED,
    targetType: 'USER',
    targetId: id,
    metadata: { email: target.email },
  })
}

export async function setAdmin(actor: AuditActor, id: string, isAdmin: boolean): Promise<void> {
  if (!isAdmin && actor.id === id) {
    throw AppError.badRequest('CANNOT_DEMOTE_SELF', 'Admin kann sich nicht selbst die Rechte entziehen')
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { isAdmin: true, email: true } })
  if (!target) throw AppError.notFound('User nicht gefunden')
  if (!isAdmin && target.isAdmin) {
    const admins = await prisma.user.count({ where: { isAdmin: true } })
    if (admins <= 1) throw AppError.badRequest('CANNOT_DEMOTE_LAST_ADMIN', 'Letzter Admin kann nicht degradiert werden')
  }
  await prisma.user.update({ where: { id }, data: { isAdmin } })
  await recordAudit({
    actor,
    action: AuditAction.ADMIN_ROLE_CHANGED,
    targetType: 'USER',
    targetId: id,
    metadata: { from: target.isAdmin, to: isAdmin },
  })
}

export async function getAttention(): Promise<AdminAttentionDto> {
  const now = new Date()
  const in7d = new Date(Date.now() + 7 * DAY_MS)
  const [sourcesErrRows, failedImports, stalePriceCache, pending, expiringSoonPro, suspendedUsers] =
    await Promise.all([
      // Sources whose most recent SyncRun errored (current broken state).
      // DISTINCT ON is backed by @@index([sourceId, startedAt]) (loose index scan
      // → one probe per source), so cost scales with #sources, not total runs.
      prisma.$queryRaw<{ c: number }[]>`
        SELECT count(*)::int AS c FROM (
          SELECT DISTINCT ON (r."sourceId") r.status
          FROM "SyncRun" r ORDER BY r."sourceId", r."startedAt" DESC
        ) latest WHERE latest.status = 'ERROR'`,
      prisma.csvImport.count({ where: { status: 'FAILED' } }),
      prisma.assetPrice.count({ where: { fetchedAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } } }),
      listPendingPayouts(),
      prisma.user.count({ where: { plan: 'PRO', planUntil: { gte: now, lte: in7d } } }),
      prisma.user.count({ where: { suspendedAt: { not: null } } }),
    ])
  return {
    sourcesInError: sourcesErrRows[0]?.c ?? 0,
    failedImports,
    stalePriceCache,
    pendingPayouts: pending.length,
    expiringSoonPro,
    suspendedUsers,
  }
}

export async function getChurnStats(): Promise<AdminChurnDto> {
  const now = new Date()
  const in7d = new Date(Date.now() + 7 * DAY_MS)
  // active/expired use the same grace cutoff as getPlan(); expiringSoon uses the
  // real planUntil window (upcoming end date, independent of grace).
  const cutoff = activeProCutoff()
  const [activePro, expiredPro, expiringSoon7d, lapsedRows] = await Promise.all([
    prisma.user.count({ where: { plan: 'PRO', OR: [{ planUntil: null }, { planUntil: { gte: cutoff } }] } }),
    prisma.user.count({ where: { plan: 'PRO', planUntil: { lt: cutoff } } }),
    prisma.user.count({ where: { plan: 'PRO', planUntil: { gte: now, lte: in7d } } }),
    prisma.user.findMany({
      where: { plan: 'PRO', planUntil: { lt: cutoff } },
      select: { email: true, planUntil: true },
      orderBy: { planUntil: 'desc' },
      take: 100,
    }),
  ])
  return {
    activePro,
    expiredPro,
    expiringSoon7d,
    lapsed: lapsedRows.map((r) => ({ email: r.email, planUntil: r.planUntil?.toISOString() ?? null })),
  }
}

export async function revokeSessions(actor: AuditActor, id: string): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({ where: { userId: id } })
  await recordAudit({
    actor,
    action: AuditAction.USER_SESSIONS_REVOKED,
    targetType: 'USER',
    targetId: id,
    metadata: { revoked: count },
  })
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

export async function voidCommission(actor: AuditActor, id: string): Promise<void> {
  const c = await prisma.referralCommission.findUnique({
    where: { id },
    select: { payoutId: true, voidedAt: true, amountCents: true, currency: true, referrerId: true },
  })
  if (!c) throw AppError.notFound('Kommission nicht gefunden')
  if (c.payoutId) throw AppError.badRequest('ALREADY_PAID', 'Bereits ausgezahlte Kommission kann nicht storniert werden')
  // Atomic conditional update — closes the race against settlePayout: only voids
  // while still unpaid + not reversed. count===0 → another tx paid/reversed it meanwhile.
  const { count } = await prisma.referralCommission.updateMany({
    where: { id, payoutId: null, status: { not: 'REVERSED' } },
    data: { status: 'REVERSED', reversedAt: new Date(), reversalReason: 'admin_void', voidedAt: new Date() },
  })
  if (count === 0) {
    throw AppError.badRequest('ALREADY_PAID', 'Kommission wurde zwischenzeitlich ausgezahlt oder storniert')
  }
  await recordAudit({
    actor,
    action: AuditAction.COMMISSION_VOIDED,
    targetType: 'COMMISSION',
    targetId: id,
    metadata: { amountCents: c.amountCents, currency: c.currency, referrerId: c.referrerId },
  })
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

// --- Admin sync -------------------------------------------------------------

export async function adminListUserSources(userId: string): Promise<AdminSourceDto[]> {
  const sources = await prisma.portfolioSource.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, label: true, type: true, provider: true, lastSyncAt: true },
  })
  if (sources.length === 0) return []
  // Single query for the latest 5 runs per source (window function) — avoids N+1.
  const ids = sources.map((s) => s.id)
  const runRows = await prisma.$queryRaw<
    {
      id: string
      sourceId: string
      status: 'RUNNING' | 'SUCCESS' | 'ERROR'
      startedAt: Date
      finishedAt: Date | null
      errorCode: string | null
      errorMessage: string | null
    }[]
  >`
    SELECT id, "sourceId", status, "startedAt", "finishedAt", "errorCode", "errorMessage"
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY "sourceId" ORDER BY "startedAt" DESC) AS rn
      FROM "SyncRun" WHERE "sourceId" IN (${Prisma.join(ids)})
    ) t WHERE rn <= 5`
  const runsBySource = new Map<string, typeof runRows>()
  for (const r of runRows) {
    const list = runsBySource.get(r.sourceId) ?? []
    list.push(r)
    runsBySource.set(r.sourceId, list)
  }
  return sources.map((s) => ({
    id: s.id,
    label: s.label,
    type: s.type,
    provider: s.provider,
    lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
    recentRuns: (runsBySource.get(s.id) ?? []).map(toSyncRunDto),
  }))
}

export async function adminTriggerSync(
  actor: AuditActor,
  sourceId: string,
): Promise<{ run: ReturnType<typeof toSyncRunDto>; queued: boolean }> {
  const source = await prisma.portfolioSource.findUnique({ where: { id: sourceId }, select: { userId: true } })
  if (!source) throw AppError.notFound('Quelle nicht gefunden')
  // Run as the owner so existing ownership checks pass.
  const result = await requestSync(source.userId, sourceId)
  await recordAudit({
    actor,
    action: AuditAction.SYNC_TRIGGERED,
    targetType: 'SOURCE',
    targetId: sourceId,
    metadata: { ownerUserId: source.userId, queued: result.queued },
  })
  return result
}
