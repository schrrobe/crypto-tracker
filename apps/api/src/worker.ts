import { Queue, Worker } from 'bullmq'
import { env } from './config/env'
import { redisConnection, SYNC_QUEUE_NAME } from './modules/sync/sync.queue'
import { enqueueAutoSync, executeSyncRun } from './modules/sync/sync.service'
import { refreshAllHeldPrices } from './coingecko/price.service'

// Queue-Worker für Background-Sync + Preis-Refresh-Cron.
// Läuft als eigener Prozess: pnpm --filter @crypto-tracker/api dev:worker

if (!env.REDIS_URL) {
  console.error('Worker braucht REDIS_URL — ohne Queue läuft der Sync inline in der API.')
  process.exit(1)
}

const PRICE_REFRESH_EVERY_MS = 15 * 60 * 1000
const AUTO_SYNC_EVERY_MS = env.AUTO_SYNC_EVERY_MINUTES * 60 * 1000

const worker = new Worker(
  SYNC_QUEUE_NAME,
  async (job) => {
    if (job.name === 'sync-run') {
      const run = await executeSyncRun((job.data as { runId: string }).runId)
      console.log(`[worker] sync-run ${run.id}: ${run.status}${run.errorCode ? ` (${run.errorCode})` : ''}`)
      return
    }
    if (job.name === 'price-refresh') {
      const result = await refreshAllHeldPrices()
      console.log(`[worker] price-refresh: ${result.assets} Assets, ok=${result.ok}${result.error ? ` (${result.error})` : ''}`)
      return
    }
    if (job.name === 'auto-sync') {
      const result = await enqueueAutoSync()
      console.log(`[worker] auto-sync: ${result.sources} Quellen angestoßen (queued=${result.queued})`)
    }
  },
  // Concurrency 1: schont Provider-Rate-Limits (gleiches Kalkül wie syncAllSources)
  { connection: redisConnection(), concurrency: 1 },
)

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.name ?? '?'} fehlgeschlagen:`, err.message)
})

// Preis-Refresh als Repeatable Job registrieren (idempotent bei mehrfachem Start)
const queue = new Queue(SYNC_QUEUE_NAME, { connection: redisConnection() })
await queue.upsertJobScheduler(
  'price-refresh-schedule',
  { every: PRICE_REFRESH_EVERY_MS },
  { name: 'price-refresh' },
)
// Auto-Sync (Pro) als Repeatable Job
await queue.upsertJobScheduler(
  'auto-sync-schedule',
  { every: AUTO_SYNC_EVERY_MS },
  { name: 'auto-sync' },
)

console.log(
  `Sync-Worker läuft (Queue "${SYNC_QUEUE_NAME}", Preis-Refresh alle ${PRICE_REFRESH_EVERY_MS / 60000} min, ` +
    `Auto-Sync alle ${AUTO_SYNC_EVERY_MS / 60000} min)`,
)

async function shutdown() {
  await worker.close()
  await queue.close()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
