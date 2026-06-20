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

// Liveness check for Redis (admin health endpoint). Uses a short-lived Queue
// and its underlying client's PING, then closes it — does not touch the worker.
export async function pingRedis(): Promise<void> {
  if (!env.REDIS_URL) throw new Error('REDIS_URL nicht gesetzt')
  const q = new Queue(SYNC_QUEUE_NAME, { connection: redisConnection() })
  try {
    // bullmq's client type omits ping(); it exists on the underlying ioredis client.
    const client = (await q.client) as unknown as { ping(): Promise<string> }
    await client.ping()
  } finally {
    await q.close()
  }
}

export async function enqueueSyncRun(runId: string): Promise<void> {
  await getQueue().add(
    'sync-run',
    { runId },
    // No auto-retry: executeSyncRun writes provider errors into the run itself
    { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
  )
}
