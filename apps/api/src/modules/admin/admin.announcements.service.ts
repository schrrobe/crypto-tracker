import { Prisma } from '@prisma/client'
import {
  AnnouncementLevel,
  type AdminAnnouncementDto,
  type AdminAnnouncementListDto,
  type AnnouncementLocale,
  type AnnouncementMessages,
  type CreateAnnouncementInput,
  type UpdateAnnouncementInput,
} from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { recordAudit, AuditAction, type AuditActor } from './audit.service'

function toDto(a: {
  id: string
  level: string
  messages: Prisma.JsonValue
  defaultLocale: string
  dismissible: boolean
  public: boolean
  active: boolean
  startsAt: Date | null
  endsAt: Date | null
  createdAt: Date
  updatedAt: Date
}): AdminAnnouncementDto {
  return {
    id: a.id,
    level: a.level as AnnouncementLevel,
    messages: (a.messages ?? {}) as AnnouncementMessages,
    defaultLocale: a.defaultLocale as AnnouncementLocale,
    dismissible: a.dismissible,
    public: a.public,
    active: a.active,
    startsAt: a.startsAt?.toISOString() ?? null,
    endsAt: a.endsAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  }
}

// Snapshot of the post-change content, so the audit log shows WHAT changed.
function auditMetadata(a: {
  level: string
  active: boolean
  public: boolean
  dismissible: boolean
  messages: Prisma.JsonValue
}) {
  return { level: a.level, active: a.active, public: a.public, dismissible: a.dismissible, messages: a.messages }
}

export async function listAnnouncements(): Promise<AdminAnnouncementListDto> {
  const rows = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } })
  return { announcements: rows.map(toDto) }
}

export async function createAnnouncement(
  actor: AuditActor,
  input: CreateAnnouncementInput,
): Promise<AdminAnnouncementDto> {
  // Keep the legacy `message` column in sync (NOT NULL, dropped in a later
  // migration) from the default-locale text, which the schema guarantees exists.
  const messages = input.messages as AnnouncementMessages
  const created = await prisma.announcement.create({
    data: {
      level: input.level,
      message: messages[input.defaultLocale] ?? '',
      messages: input.messages as Prisma.InputJsonValue,
      defaultLocale: input.defaultLocale,
      dismissible: input.dismissible,
      public: input.public,
      active: input.active,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
    },
  })
  await recordAudit({
    actor,
    action: AuditAction.ANNOUNCEMENT_CREATED,
    targetType: 'ANNOUNCEMENT',
    targetId: created.id,
    metadata: auditMetadata(created),
  })
  return toDto(created)
}

export async function updateAnnouncement(
  actor: AuditActor,
  id: string,
  input: UpdateAnnouncementInput,
): Promise<AdminAnnouncementDto> {
  const existing = await prisma.announcement.findUnique({ where: { id } })
  if (!existing) throw AppError.notFound('Ankündigung nicht gefunden')

  // C1: re-validate the MERGED window. The PATCH schema is partial and the
  // payload-only check can't see fields it doesn't carry, so verify against the
  // effective (merged) start/end here — otherwise PATCH could persist end<=start.
  const effStart =
    input.startsAt !== undefined ? (input.startsAt ? new Date(input.startsAt) : null) : existing.startsAt
  const effEnd = input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : existing.endsAt
  if (effStart && effEnd && effEnd <= effStart) {
    throw AppError.badRequest('VALIDATION_ERROR', 'Ende muss nach dem Start liegen')
  }

  const data: Prisma.AnnouncementUpdateInput = {}
  if (input.level !== undefined) data.level = input.level
  if (input.active !== undefined) data.active = input.active
  if (input.dismissible !== undefined) data.dismissible = input.dismissible
  if (input.public !== undefined) data.public = input.public
  if (input.startsAt !== undefined) data.startsAt = input.startsAt ? new Date(input.startsAt) : null
  if (input.endsAt !== undefined) data.endsAt = input.endsAt ? new Date(input.endsAt) : null
  if (input.messages !== undefined) data.messages = input.messages as Prisma.InputJsonValue
  if (input.defaultLocale !== undefined) data.defaultLocale = input.defaultLocale

  // Keep the legacy `message` column aligned with the effective default locale.
  if (input.messages !== undefined || input.defaultLocale !== undefined) {
    const effMessages = (input.messages ?? existing.messages ?? {}) as AnnouncementMessages
    const effLocale = (input.defaultLocale ?? existing.defaultLocale) as AnnouncementLocale
    // Re-validate the MERGED default-locale message: PATCHing defaultLocale alone
    // (no messages) skips the schema check and could point at an empty locale →
    // the banner would render blank. Mirror the C1 merged-window approach.
    if (!effMessages[effLocale]?.trim()) {
      throw AppError.badRequest('VALIDATION_ERROR', 'Die Standardsprache benötigt eine Nachricht')
    }
    data.message = effMessages[effLocale] ?? existing.message
  }

  const updated = await prisma.announcement.update({ where: { id }, data })
  await recordAudit({
    actor,
    action: AuditAction.ANNOUNCEMENT_UPDATED,
    targetType: 'ANNOUNCEMENT',
    targetId: id,
    metadata: auditMetadata(updated),
  })
  return toDto(updated)
}

export async function deleteAnnouncement(actor: AuditActor, id: string): Promise<void> {
  await prisma.announcement.delete({ where: { id } }).catch(() => {
    throw AppError.notFound('Ankündigung nicht gefunden')
  })
  await recordAudit({ actor, action: AuditAction.ANNOUNCEMENT_DELETED, targetType: 'ANNOUNCEMENT', targetId: id })
}
