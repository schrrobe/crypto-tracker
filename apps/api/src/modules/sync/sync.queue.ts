import { Queue } from 'bullmq'
import { env } from '../../config/env'

// Queue mode is optional: without REDIS_URL the sync runs inline (tests, simple
// local setup). With REDIS_URL the route only creates the run and enqueues it —
// the worker (src/worker.ts) executes it.

export const SYNC_QUEUE_NAME = 'sync'

let queue: Queue | null = null

export function isQueueEnabled(): boolean {
  return env.REDIS_URL !== undefined
}

export function redisConnection(): { url: string } {
  if (!env.REDIS_URL) throw new Error('REDIS_URL ist nicht gesetzt')
  return { url: env.REDIS_URL }
}

function getQueue(): Queue {
  if (!env.REDIS_URL) throw new Error('Queue-Modus ohne REDIS_URL')
  if (!queue) {
    queue = new Queue(SYNC_QUEUE_NAME, { connection: redisConnection() })
  }
  return queue
}

const PING_TIMEOUT_MS = 2000

// Liveness check for Redis (admin health endpoint + sync-request preflight).
// Reuses the cached queue's client — no per-call connection churn — and caps the
// wait so a black-holed Redis host can't hang the caller for ~ioredis connectTimeout
// (~10s). On timeout it rejects; callers treat that as "Redis unavailable".
export async function pingRedis(): Promise<void> {
  if (!env.REDIS_URL) throw new Error('REDIS_URL nicht gesetzt')
  const ping = (async () => {
    // bullmq's client type omits ping(); it exists on the underlying ioredis client.
    const client = (await getQueue().client) as unknown as { ping(): Promise<string> }
    await client.ping()
  })()
  ping.catch(() => {}) // swallow late rejection after a timeout to avoid unhandledRejection
  await Promise.race([
    ping,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Redis-PING Timeout nach ${PING_TIMEOUT_MS}ms`)), PING_TIMEOUT_MS),
    ),
  ])
}

export async function enqueueSyncRun(runId: string): Promise<void> {
  await getQueue().add(
    'sync-run',
    { runId },
    // Provider errors (rate limit, bad key) are written INTO the run and do not
    // throw, so they never trigger a retry — they surface to the user as-is.
    // attempts/backoff only matter for infrastructure throws (DB blip, transient
    // crash): executeSyncRun is idempotent on a still-RUNNING run, so re-running
    // is safe. jobId = runId deduplicates accidental double-enqueue of one run.
    {
      jobId: runId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  )
}
