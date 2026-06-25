import { Queue, Worker } from 'bullmq'
import { env } from './config/env'
import { redisConnection, SYNC_QUEUE_NAME } from './modules/sync/sync.queue'
import { enqueueAutoSync, executeSyncRun, reapStaleRuns } from './modules/sync/sync.service'
import { refreshAllHeldPrices } from './coingecko/price.service'

// Queue worker for background sync + price-refresh / auto-sync / stale-run-reaper crons.
// Runs as its own process: pnpm --filter @crypto-tracker/api dev:worker
//
// NOTE: concurrency is 1 PER worker process — it spares provider rate limits.
// Running more than one worker re-parallelises syncs and breaks that assumption,
// so deploy a SINGLE worker (the repeatable schedulers are deduplicated by key
// across workers, but job execution is not globally serialized).

if (!env.REDIS_URL) {
  console.error('Worker braucht REDIS_URL — ohne Queue läuft der Sync inline in der API.')
  process.exit(1)
}

const PRICE_REFRESH_EVERY_MS = 15 * 60 * 1000
const AUTO_SYNC_EVERY_MS = env.AUTO_SYNC_EVERY_MINUTES * 60 * 1000
const REAP_STALE_EVERY_MS = 5 * 60 * 1000

// Structured single-line JSON logs so an operator can grep/correlate by runId.
function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', event, ...fields }))
}

const worker = new Worker(
  SYNC_QUEUE_NAME,
  async (job) => {
    if (job.name === 'sync-run') {
      const runId = (job.data as { runId: string }).runId
      const run = await executeSyncRun(runId)
      log('sync-run', { runId: run.id, status: run.status, errorCode: run.errorCode ?? null })
      return
    }
    if (job.name === 'price-refresh') {
      const result = await refreshAllHeldPrices()
      log('price-refresh', { assets: result.assets, ok: result.ok, error: result.error ?? null })
      return
    }
    if (job.name === 'auto-sync') {
      const result = await enqueueAutoSync()
      log('auto-sync', { sources: result.sources, queued: result.queued })
      return
    }
    if (job.name === 'reap-stale') {
      const result = await reapStaleRuns()
      if (result.reaped > 0) log('reap-stale', { reaped: result.reaped })
      return
    }
  },
  // Concurrency 1: spares provider rate limits (same reasoning as syncAllSources)
  { connection: redisConnection(), concurrency: 1 },
)

worker.on('failed', (job, err) => {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      event: 'job-failed',
      job: job?.name ?? '?',
      runId: (job?.data as { runId?: string } | undefined)?.runId ?? null,
      attemptsMade: job?.attemptsMade ?? null,
      error: err.message,
    }),
  )
})

// Repeatable jobs are idempotent across restarts (keyed by scheduler id).
const queue = new Queue(SYNC_QUEUE_NAME, { connection: redisConnection() })
await queue.upsertJobScheduler('price-refresh-schedule', { every: PRICE_REFRESH_EVERY_MS }, { name: 'price-refresh' })
// Auto-sync (Pro) as a repeatable job
await queue.upsertJobScheduler('auto-sync-schedule', { every: AUTO_SYNC_EVERY_MS }, { name: 'auto-sync' })
// Reaper: marks crashed RUNNING runs as ERROR/STALE
await queue.upsertJobScheduler('reap-stale-schedule', { every: REAP_STALE_EVERY_MS }, { name: 'reap-stale' })

log('worker-started', {
  queue: SYNC_QUEUE_NAME,
  priceRefreshMin: PRICE_REFRESH_EVERY_MS / 60000,
  autoSyncMin: AUTO_SYNC_EVERY_MS / 60000,
  reapStaleMin: REAP_STALE_EVERY_MS / 60000,
})

async function shutdown() {
  await worker.close()
  await queue.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
