import type {
  AdminActivityDto,
  AdminAssetsDto,
  AdminAttentionDto,
  AdminAuditListDto,
  AdminChurnDto,
  AdminReferralRewardDto,
  AdminGrowthPointDto,
  AdminHealthDto,
  AdminImportsDto,
  AdminOverviewDto,
  AdminPriceCacheDto,
  AdminSourceDto,
  AdminSyncHealthDto,
  AdminUserDetailDto,
  AdminUserListDto,
  AdminUpdatePlanInput,
  SyncRunDto,
  CreateSurveyInput,
  FreeTextAnswerListDto,
  SurveyListDto,
  SurveyResultsDto,
  UpdateSurveyInput,
  AdminAnnouncementDto,
  AdminAnnouncementListDto,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from '@crypto-tracker/shared'
import { api, downloadFile } from './api.client'

interface CountList {
  byType?: { key: string; count: number }[]
  byProvider?: { key: string; count: number }[]
  staleCount?: number
}
export const adminApi = {
  overview: () => api.get<AdminOverviewDto>('/admin/stats/overview'),
  growth: (days = 30) => api.get<{ points: AdminGrowthPointDto[] }>(`/admin/stats/growth?days=${days}`),
  syncHealth: (days = 7) => api.get<AdminSyncHealthDto>(`/admin/stats/sync-health?days=${days}`),
  sources: () => api.get<Required<CountList>>('/admin/stats/sources'),
  imports: () => api.get<AdminImportsDto>('/admin/stats/imports'),
  assets: () => api.get<AdminAssetsDto>('/admin/stats/assets'),
  transactions: (days = 30) =>
    api.get<{ perDay: { date: string; count: number }[]; byType: { key: string; count: number }[] }>(
      `/admin/stats/transactions?days=${days}`,
    ),
  priceCache: () => api.get<AdminPriceCacheDto>('/admin/stats/price-cache'),
  churn: () => api.get<AdminChurnDto>('/admin/stats/churn'),
  activity: () => api.get<AdminActivityDto>('/admin/stats/activity'),
  attention: () => api.get<AdminAttentionDto>('/admin/stats/attention'),
  health: () => api.get<AdminHealthDto>('/admin/stats/health'),

  users: (params: { search?: string; plan?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams()
    if (params.search) q.set('search', params.search)
    if (params.plan) q.set('plan', params.plan)
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    return api.get<AdminUserListDto>(`/admin/users?${q.toString()}`)
  },
  user: (id: string) => api.get<AdminUserDetailDto>(`/admin/users/${id}`),
  userSources: (id: string) => api.get<{ sources: AdminSourceDto[] }>(`/admin/users/${id}/sources`),
  triggerSync: (sourceId: string) =>
    api.post<{ run: SyncRunDto; queued: boolean }>(`/admin/sources/${sourceId}/sync`),
  updatePlan: (id: string, input: AdminUpdatePlanInput) => api.patch<void>(`/admin/users/${id}/plan`, input),
  deleteUser: (id: string) => api.delete<void>(`/admin/users/${id}`),
  revokeSessions: (id: string) => api.post<{ revoked: number }>(`/admin/users/${id}/revoke-sessions`),
  suspend: (id: string) => api.post<void>(`/admin/users/${id}/suspend`),
  unsuspend: (id: string) => api.post<void>(`/admin/users/${id}/unsuspend`),
  setAdmin: (id: string, isAdmin: boolean) => api.patch<void>(`/admin/users/${id}/admin`, { isAdmin }),

  referralRewards: () => api.get<{ rewards: AdminReferralRewardDto[] }>('/admin/referral/rewards'),

  audit: (params: { action?: string; targetId?: string; page?: number; pageSize?: number }) => {
    const q = new URLSearchParams()
    if (params.action) q.set('action', params.action)
    if (params.targetId) q.set('targetId', params.targetId)
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    return api.get<AdminAuditListDto>(`/admin/audit?${q.toString()}`)
  },

  surveys: () => api.get<SurveyListDto>('/admin/surveys'),
  createSurvey: (input: CreateSurveyInput) => api.post<{ id: string }>('/admin/surveys', input),
  updateSurvey: (id: string, input: UpdateSurveyInput) => api.patch<void>(`/admin/surveys/${id}`, input),
  publishSurvey: (id: string) => api.post<void>(`/admin/surveys/${id}/publish`),
  closeSurvey: (id: string) => api.post<void>(`/admin/surveys/${id}/close`),
  deleteSurvey: (id: string) => api.delete<void>(`/admin/surveys/${id}`),
  surveyResults: (id: string) => api.get<SurveyResultsDto>(`/admin/surveys/${id}/results`),
  surveyFreeText: (id: string, params: { questionId: string; q?: string; page?: number; pageSize?: number }) => {
    const sp = new URLSearchParams()
    sp.set('questionId', params.questionId)
    if (params.q) sp.set('q', params.q)
    if (params.page) sp.set('page', String(params.page))
    if (params.pageSize) sp.set('pageSize', String(params.pageSize))
    return api.get<FreeTextAnswerListDto>(`/admin/surveys/${id}/free-text?${sp.toString()}`)
  },
  surveyFreeTextCsv: (id: string, questionId: string) =>
    downloadFile(`/admin/surveys/${id}/free-text/export.csv?questionId=${questionId}`, `survey-${id}-free-text.csv`),

  announcements: () => api.get<AdminAnnouncementListDto>('/admin/announcements'),
  createAnnouncement: (input: CreateAnnouncementInput) =>
    api.post<{ announcement: AdminAnnouncementDto }>('/admin/announcements', input),
  updateAnnouncement: (id: string, input: UpdateAnnouncementInput) =>
    api.patch<{ announcement: AdminAnnouncementDto }>(`/admin/announcements/${id}`, input),
  deleteAnnouncement: (id: string) => api.delete<void>(`/admin/announcements/${id}`),
}
