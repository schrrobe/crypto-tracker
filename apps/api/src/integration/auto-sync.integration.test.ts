import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import { enqueueAutoSync } from '../modules/sync/sync.service'
import { createExchangeSource, registerUser } from './helpers'

// enqueueAutoSync is global (all Pro users). We specifically check the sources
// of our test users. FAKE_PROVIDERS=true → sync runs inline and returns SUCCESS.
async function runCount(userId: string): Promise<number> {
  const source = await prisma.portfolioSource.findFirst({ where: { userId } })
  if (!source) return 0
  return prisma.syncRun.count({ where: { sourceId: source.id } })
}

describe('Auto-Sync (Integration)', () => {
  it('synct Pro-Quellen, Free-Quellen nicht', async () => {
    const pro = await registerUser('autosync-pro') // registerUser → default PRO
    await createExchangeSource(pro, 'Pro Kraken')
    const free = await registerUser('autosync-free', 'FREE')
    await createExchangeSource(free, 'Free Kraken')

    await enqueueAutoSync()

    expect(await runCount(pro.userId)).toBeGreaterThan(0)
    expect(await runCount(free.userId)).toBe(0)
    // enqueueAutoSync is global: syncs all Pro sources accumulated in the test DB
    // inline (each now with multi-account + futures) → generous timeout
  }, 30000)

  it('überspringt Pro-Nutzer mit autoSyncEnabled=false', async () => {
    const user = await registerUser('autosync-off') // PRO
    await prisma.user.update({ where: { id: user.userId }, data: { autoSyncEnabled: false } })
    await createExchangeSource(user, 'Off Kraken')

    await enqueueAutoSync()

    expect(await runCount(user.userId)).toBe(0)
  }, 30000)
})
