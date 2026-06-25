import { AnnouncementLevel, type AnnouncementDto } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'

// Active announcements within their optional [startsAt, endsAt] window.
// ERROR before INFO, then newest first.
export async function listActiveAnnouncements(): Promise<AnnouncementDto[]> {
  const now = new Date()
  const announcements = await prisma.announcement.findMany({
    where: {
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: [{ level: 'asc' }, { createdAt: 'desc' }],
  })
  // level enum order: ERROR sorts before INFO alphabetically, which matches priority.
  return announcements.map((a) => ({
    id: a.id,
    level: a.level as AnnouncementLevel,
    message: a.message,
  }))
}
