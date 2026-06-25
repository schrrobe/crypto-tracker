import { Prisma } from '@prisma/client'
import {
  AnnouncementLevel,
  type AdminAnnouncementDto,
  type AdminAnnouncementListDto,
  type CreateAnnouncementInput,
  type UpdateAnnouncementInput,
} from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { recordAudit, AuditAction, type AuditActor } from './audit.service'

function toDto(a: {
  id: string
  level: string
  message: string
  active: boolean
  startsAt: Date | null
  endsAt: Date | null
  createdAt: Date
}): AdminAnnouncementDto {
  return {
    id: a.id,
    level: a.level as AnnouncementLevel,
    message: a.message,
    active: a.active,
    startsAt: a.startsAt?.toISOString() ?? null,
    endsAt: a.endsAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  }
}

export async function listAnnouncements(): Promise<AdminAnnouncementListDto> {
  const rows = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } })
  return { announcements: rows.map(toDto) }
}

export async function createAnnouncement(
  actor: AuditActor,
  input: CreateAnnouncementInput,
): Promise<AdminAnnouncementDto> {
  const created = await prisma.announcement.create({
    data: {
      level: input.level,
      message: input.message,
      active: input.active,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
    },
  })
  await recordAudit({ actor, action: AuditAction.ANNOUNCEMENT_CREATED, targetType: 'ANNOUNCEMENT', targetId: created.id })
  return toDto(created)
}

export async function updateAnnouncement(
  actor: AuditActor,
  id: string,
  input: UpdateAnnouncementInput,
): Promise<AdminAnnouncementDto> {
  const data: Prisma.AnnouncementUpdateInput = {}
  if (input.level !== undefined) data.level = input.level
  if (input.message !== undefined) data.message = input.message
  if (input.active !== undefined) data.active = input.active
  if (input.startsAt !== undefined) data.startsAt = input.startsAt ? new Date(input.startsAt) : null
  if (input.endsAt !== undefined) data.endsAt = input.endsAt ? new Date(input.endsAt) : null

  const updated = await prisma.announcement
    .update({ where: { id }, data })
    .catch(() => {
      throw AppError.notFound('Ankündigung nicht gefunden')
    })
  await recordAudit({ actor, action: AuditAction.ANNOUNCEMENT_UPDATED, targetType: 'ANNOUNCEMENT', targetId: id })
  return toDto(updated)
}

export async function deleteAnnouncement(actor: AuditActor, id: string): Promise<void> {
  await prisma.announcement.delete({ where: { id } }).catch(() => {
    throw AppError.notFound('Ankündigung nicht gefunden')
  })
  await recordAudit({ actor, action: AuditAction.ANNOUNCEMENT_DELETED, targetType: 'ANNOUNCEMENT', targetId: id })
}
