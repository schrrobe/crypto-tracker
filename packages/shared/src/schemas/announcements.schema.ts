import { z } from 'zod'
import { AnnouncementLevel } from '../enums'

const LEVELS = Object.values(AnnouncementLevel) as [AnnouncementLevel, ...AnnouncementLevel[]]

export const createAnnouncementSchema = z
  .object({
    level: z.enum(LEVELS),
    message: z.string().trim().min(1, 'Nachricht darf nicht leer sein').max(500),
    active: z.boolean().default(false),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((a) => !a.startsAt || !a.endsAt || new Date(a.endsAt) > new Date(a.startsAt), {
    message: 'Ende muss nach dem Start liegen',
    path: ['endsAt'],
  })
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>

// .partial() drops the refine; re-validate the window after merge in the service if needed.
export const updateAnnouncementSchema = z
  .object({
    level: z.enum(LEVELS),
    message: z.string().trim().min(1, 'Nachricht darf nicht leer sein').max(500),
    active: z.boolean(),
    startsAt: z.string().datetime({ offset: true }).nullable(),
    endsAt: z.string().datetime({ offset: true }).nullable(),
  })
  .partial()
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>

// ── DTOs ─────────────────────────────────────────────────────────────────────

// User-facing: only what the banner needs.
export interface AnnouncementDto {
  id: string
  level: AnnouncementLevel
  message: string
}

export interface AdminAnnouncementDto {
  id: string
  level: AnnouncementLevel
  message: string
  active: boolean
  startsAt: string | null
  endsAt: string | null
  createdAt: string
}

export interface AdminAnnouncementListDto {
  announcements: AdminAnnouncementDto[]
}
