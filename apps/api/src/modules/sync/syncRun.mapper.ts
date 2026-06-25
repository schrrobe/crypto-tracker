import type { SyncRun } from '@prisma/client'
import type { SyncRunDto } from '@crypto-tracker/shared'

// Only the DTO-relevant fields are required, so callers projecting a subset of
// SyncRun (e.g. raw SQL in the admin dashboard) don't need to select heartbeatAt.
export function toSyncRunDto(run: Pick<SyncRun, 'id' | 'status' | 'startedAt' | 'finishedAt' | 'errorCode' | 'errorMessage'>): SyncRunDto {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
  }
}
