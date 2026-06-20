import { z } from 'zod'

// --- Stats ------------------------------------------------------------------

export interface AdminOverviewDto {
  totalUsers: number
  proUsers: number
  freeUsers: number
  proRatePct: number
  newUsers7d: number
  newUsers30d: number
  activeSubscriptions: number
  mrrProxyCents: number
  referral: {
    owedCents: number
    paidCents: number
    activeReferrers: number
    invitedUsers: number
  }
}

export interface AdminGrowthPointDto {
  date: string // YYYY-MM-DD
  signups: number
  cumulative: number
}

export interface AdminCountDto {
  key: string
  count: number
}

export interface AdminSyncHealthDto {
  success: number
  error: number
  byProvider: AdminCountDto[]
  topErrorCodes: AdminCountDto[]
}

export interface AdminImportsDto {
  byStatus: AdminCountDto[]
  totalRows: number
  importedRows: number
  errorRows: number
}

export interface AdminAssetsDto {
  distinctAssets: number
  topAssets: AdminCountDto[]
  byAccountType: AdminCountDto[]
}

export interface AdminPriceCacheDto {
  cachedAssets: number
  oldestFetchedAt: string | null
  newestFetchedAt: string | null
  staleCount: number
  historicalRows: number
}

// --- Users ------------------------------------------------------------------

export interface AdminUserListItemDto {
  id: string
  email: string
  plan: 'FREE' | 'PRO'
  planUntil: string | null
  isAdmin: boolean
  sourcesCount: number
  referredByEmail: string | null
  createdAt: string
}

export interface AdminUserListDto {
  users: AdminUserListItemDto[]
  total: number
  page: number
  pageSize: number
}

export interface AdminUserDetailDto extends AdminUserListItemDto {
  portfoliosCount: number
  holdingsCount: number
  invitedCount: number
  activeSessions: number
  earnings: { owedCents: number; paidCents: number; currency: string }
}

export interface AdminCommissionDto {
  id: string
  referrerEmail: string
  referredUserId: string
  amountCents: number
  currency: string
  payoutId: string | null
  voidedAt: string | null
  createdAt: string
}

export const adminUpdatePlanSchema = z.object({
  plan: z.enum(['FREE', 'PRO']),
  planUntil: z.string().datetime().nullable().optional(),
})
export type AdminUpdatePlanInput = z.infer<typeof adminUpdatePlanSchema>

// --- Audit log --------------------------------------------------------------

export interface AdminAuditDto {
  id: string
  actorEmail: string
  action: string
  targetType: string
  targetId: string | null
  metadata: unknown
  createdAt: string
}

export interface AdminAuditListDto {
  audit: AdminAuditDto[]
  total: number
  page: number
  pageSize: number
}

export const adminAuditQuerySchema = z.object({
  action: z.string().optional(),
  targetId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

// --- Admin source view (for manual sync) ------------------------------------

export interface AdminSourceDto {
  id: string
  label: string
  type: string
  provider: string | null
  lastSyncAt: string | null
  recentRuns: import('./portfolio.schema').SyncRunDto[]
}

export const adminUsersQuerySchema = z.object({
  search: z.string().trim().optional(),
  plan: z.enum(['FREE', 'PRO']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
