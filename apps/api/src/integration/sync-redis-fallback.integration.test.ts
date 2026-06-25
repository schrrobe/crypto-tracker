import { describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { createExchangeSource, registerUser } from './helpers'

// Queue ON but Redis dead: requestSync must fall back to inline execution rather
// than leaving a RUNNING run that nothing ever finishes. The real sync tests run
// with no REDIS_URL (inline), so this branch needs the queue forced on + a failing
// ping — isolated in its own file so the mock can't leak into the inline tests.
vi.mock('../modules/sync/sync.queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/sync/sync.queue')>()
  return {
    ...actual,
    isQueueEnabled: () => true,
    pingRedis: vi.fn().mockRejectedValue(new Error('Redis down')),
    enqueueSyncRun: vi.fn().mockResolvedValue(undefined),
  }
})

describe('requestSync — Redis-Fallback', () => {
  it('totes Redis → Inline-Ausführung, kein verwaister RUNNING-Run', async () => {
    const { requestSync } = await import('../modules/sync/sync.service')
    const user = await registerUser('redis-fallback')
    const source = await createExchangeSource(user, 'Fallback Exchange')

    const result = await requestSync(user.userId, source.id)

    // Did not queue — ran inline despite queue being "enabled"
    expect(result.queued).toBe(false)
    // Run reached a terminal state, not stuck RUNNING
    expect(result.run.status).not.toBe('RUNNING')
    // No orphaned RUNNING run left behind
    const running = await prisma.syncRun.findMany({ where: { sourceId: source.id, status: 'RUNNING' } })
    expect(running).toHaveLength(0)
  })
})
