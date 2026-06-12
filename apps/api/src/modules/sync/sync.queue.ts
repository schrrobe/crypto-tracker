import { Queue } from 'bullmq'
import { env } from '../../config/env'

// Queue-Modus ist optional: ohne REDIS_URL läuft der Sync inline (Tests, einfaches
// lokales Setup). Mit REDIS_URL legt die Route nur noch den Run an und enqueued —
// der Worker (src/worker.ts) führt aus.

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

export async function enqueueSyncRun(runId: string): Promise<void> {
  await getQueue().add(
    'sync-run',
    { runId },
    // Kein Auto-Retry: executeSyncRun schreibt Provider-Fehler selbst in den Run
    { attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
  )
}
