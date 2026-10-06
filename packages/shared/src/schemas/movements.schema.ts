import { z } from 'zod'
import type { HoldingAccountType, SourceType } from '../enums'
import type { AssetDto } from './portfolio.schema'

export const MovementKind = {
  OPENING: 'OPENING',
  CHANGE: 'CHANGE',
} as const
export type MovementKind = (typeof MovementKind)[keyof typeof MovementKind]

export const MovementOrigin = {
  SYNC: 'SYNC',
  MANUAL: 'MANUAL',
  IMPORT: 'IMPORT',
} as const
export type MovementOrigin = (typeof MovementOrigin)[keyof typeof MovementOrigin]

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const movementsQuerySchema = z.object({
  portfolioId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
  // Day boundaries for the daily grouping follow the viewer's time zone
  tz: z.string().max(64).refine(isValidTimeZone, 'Ungültige Zeitzone').default('Europe/Berlin'),
  // Unpriced (spam/unknown) tokens are hidden unless explicitly requested
  includeUnpriced: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})
export type MovementsQuery = z.infer<typeof movementsQuerySchema>

// One statement line: all movements of one asset/account type in one source on
// one day, netted. `quantityAfter` is the running quantity balance after the
// day's last movement; `valueEur` is the delta valued at the booking-time rate.
export interface MovementGroupDto {
  day: string
  sourceId: string
  sourceLabel: string
  sourceType: SourceType
  asset: AssetDto
  accountType: HoldingAccountType
  kind: MovementKind
  origin: MovementOrigin
  delta: string
  quantityAfter: string
  valueEur: string | null
  valueUsd: string | null
  count: number
  lastAt: string
}

export interface MovementsResponseDto {
  groups: MovementGroupDto[]
  // Visible history window for the user's plan (Free 30, Pro 365 days)
  historyDays: number
  hasMore: boolean
}
