import { z } from 'zod'
import { AnnouncementLevel } from '../enums'

const LEVELS = Object.values(AnnouncementLevel) as [AnnouncementLevel, ...AnnouncementLevel[]]

// Locale codes must stay in sync with apps/mobile/src/i18n SUPPORTED_LOCALES.
export const ANNOUNCEMENT_LOCALES = ['de', 'en', 'fr', 'pl', 'cs', 'ru'] as const
export type AnnouncementLocale = (typeof ANNOUNCEMENT_LOCALES)[number]

const localeEnum = z.enum(ANNOUNCEMENT_LOCALES)
const messageText = z
  .string()
  .trim()
  .min(1, 'Nachricht darf nicht leer sein')
  .max(500, 'Nachricht darf höchstens 500 Zeichen haben')

// Per-locale message map. Unknown locale keys are rejected by z.record's key enum.
const messagesSchema = z.record(localeEnum, messageText)

export type AnnouncementMessages = Partial<Record<AnnouncementLocale, string>>

// Resolve order: requested locale → defaultLocale → first available → ''.
export function resolveAnnouncementMessage(
  messages: AnnouncementMessages,
  defaultLocale: AnnouncementLocale,
  requested: string,
): string {
  return (
    messages[requested as AnnouncementLocale] ??
    messages[defaultLocale] ??
    Object.values(messages).find((m) => typeof m === 'string' && m.length > 0) ??
    ''
  )
}

// Shared level presentation so mobile banner and admin preview cannot drift.
// Severity weight drives ERROR-before-INFO ordering (do NOT rely on enum order).
export const ANNOUNCEMENT_LEVEL_STYLE: Record<
  AnnouncementLevel,
  { weight: number; bg: string; fg: string; icon: string; role: 'alert' | 'status'; labelKey: string }
> = {
  ERROR: { weight: 0, bg: '#c0392b', fg: '#ffffff', icon: '⚠', role: 'alert', labelKey: 'announcement.level.error' },
  INFO: { weight: 1, bg: '#2d6cdf', fg: '#ffffff', icon: 'ⓘ', role: 'status', labelKey: 'announcement.level.info' },
}

export const createAnnouncementSchema = z
  .object({
    level: z.enum(LEVELS),
    messages: messagesSchema,
    defaultLocale: localeEnum,
    active: z.boolean().default(false),
    dismissible: z.boolean().default(true),
    public: z.boolean().default(false),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.startsAt && a.endsAt && new Date(a.endsAt) <= new Date(a.startsAt)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ende muss nach dem Start liegen', path: ['endsAt'] })
    }
    if (!a.messages[a.defaultLocale]?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Die Standardsprache benötigt eine Nachricht',
        path: ['defaultLocale'],
      })
    }
  })
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>

// All fields optional (PATCH). The payload-internal window/default-locale checks
// live here; the MERGED-window check (C1) lives in the service, which knows the
// current row. Both are required — neither alone is sufficient.
export const updateAnnouncementSchema = z
  .object({
    level: z.enum(LEVELS).optional(),
    messages: messagesSchema.optional(),
    defaultLocale: localeEnum.optional(),
    active: z.boolean().optional(),
    dismissible: z.boolean().optional(),
    public: z.boolean().optional(),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((a, ctx) => {
    if (a.startsAt && a.endsAt && new Date(a.endsAt) <= new Date(a.startsAt)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ende muss nach dem Start liegen', path: ['endsAt'] })
    }
    if (a.messages && a.defaultLocale && !a.messages[a.defaultLocale]?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Die Standardsprache benötigt eine Nachricht',
        path: ['defaultLocale'],
      })
    }
  })
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>

// ── DTOs ─────────────────────────────────────────────────────────────────────

// User-facing: never leaks active/startsAt/endsAt. updatedAt feeds the per-device
// dismiss key (id:updatedAt) so an edited announcement re-surfaces.
export interface AnnouncementDto {
  id: string
  level: AnnouncementLevel
  messages: AnnouncementMessages
  defaultLocale: AnnouncementLocale
  dismissible: boolean
  updatedAt: string
}

export interface AdminAnnouncementDto {
  id: string
  level: AnnouncementLevel
  messages: AnnouncementMessages
  defaultLocale: AnnouncementLocale
  dismissible: boolean
  public: boolean
  active: boolean
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminAnnouncementListDto {
  announcements: AdminAnnouncementDto[]
}
