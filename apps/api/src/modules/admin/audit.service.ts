import { prisma } from '../../lib/prisma'
import type { AdminAuditDto, AdminAuditListDto } from '@crypto-tracker/shared'

// Audit action constants (string, stored verbatim).
export const AuditAction = {
  USER_PLAN_CHANGED: 'USER_PLAN_CHANGED',
  USER_DELETED: 'USER_DELETED',
  USER_SESSIONS_REVOKED: 'USER_SESSIONS_REVOKED',
  COMMISSION_VOIDED: 'COMMISSION_VOIDED',
  PAYOUT_SETTLED: 'PAYOUT_SETTLED',
  SYNC_TRIGGERED: 'SYNC_TRIGGERED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_UNSUSPENDED: 'USER_UNSUSPENDED',
  ADMIN_ROLE_CHANGED: 'ADMIN_ROLE_CHANGED',
  SURVEY_CREATED: 'SURVEY_CREATED',
  SURVEY_UPDATED: 'SURVEY_UPDATED',
  SURVEY_PUBLISHED: 'SURVEY_PUBLISHED',
  SURVEY_CLOSED: 'SURVEY_CLOSED',
  SURVEY_DELETED: 'SURVEY_DELETED',
} as const

export type AuditActor = { id: string; email: string }

export async function recordAudit(input: {
  actor: AuditActor
  action: string
  targetType: string
  targetId?: string | null
  metadata?: unknown
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.actor.id,
      actorEmail: input.actor.email,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: (input.metadata ?? undefined) as object | undefined,
    },
  })
}

export async function listAudit(query: {
  action?: string
  targetId?: string
  page: number
  pageSize: number
}): Promise<AdminAuditListDto> {
  const where = {
    ...(query.action ? { action: query.action } : {}),
    ...(query.targetId ? { targetId: query.targetId } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ])
  const audit: AdminAuditDto[] = rows.map((r) => ({
    id: r.id,
    actorEmail: r.actorEmail,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
  }))
  return { audit, total, page: query.page, pageSize: query.pageSize }
}
