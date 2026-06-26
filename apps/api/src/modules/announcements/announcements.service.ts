import {
  AnnouncementLevel,
  ANNOUNCEMENT_LEVEL_STYLE,
  type AnnouncementDto,
  type AnnouncementLocale,
  type AnnouncementMessages,
} from '@crypto-tracker/shared'
import type { Announcement } from '@prisma/client'
import { prisma } from '../../lib/prisma'

const MAX_VISIBLE = 5

function windowWhere(now: Date) {
  return {
    active: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  }
}

function toDto(a: Announcement): AnnouncementDto {
  return {
    id: a.id,
    level: a.level as AnnouncementLevel,
    messages: (a.messages ?? {}) as AnnouncementMessages,
    defaultLocale: a.defaultLocale as AnnouncementLocale,
    dismissible: a.dismissible,
    updatedAt: a.updatedAt.toISOString(),
  }
}

// ERROR before INFO by explicit severity weight (NEVER rely on enum sort order),
// then newest first, then id for a deterministic tiebreaker. Cap at MAX_VISIBLE
// AFTER the priority sort so ERROR survives truncation.
function prioritize(rows: Announcement[]): Announcement[] {
  return [...rows]
    .sort((a, b) => {
      const wa = ANNOUNCEMENT_LEVEL_STYLE[a.level as AnnouncementLevel].weight
      const wb = ANNOUNCEMENT_LEVEL_STYLE[b.level as AnnouncementLevel].weight
      if (wa !== wb) return wa - wb
      if (b.createdAt.getTime() !== a.createdAt.getTime()) return b.createdAt.getTime() - a.createdAt.getTime()
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .slice(0, MAX_VISIBLE)
}

// Authed: all active announcements within their window.
export async function listActiveAnnouncements(): Promise<AnnouncementDto[]> {
  const now = new Date()
  const rows = await prisma.announcement.findMany({ where: windowWhere(now) })
  return prioritize(rows).map(toDto)
}

// Public (no auth): only announcements flagged public, within their window.
export async function listPublicAnnouncements(): Promise<AnnouncementDto[]> {
  const now = new Date()
  const rows = await prisma.announcement.findMany({ where: { public: true, ...windowWhere(now) } })
  return prioritize(rows).map(toDto)
}
