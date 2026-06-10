import type { SyncRun } from '@prisma/client'
import type { SyncRunDto } from '@crypto-tracker/shared'

export function toSyncRunDto(run: SyncRun): SyncRunDto {
  return {
    id: run.id,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
  }
}
