import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import { enqueueAutoSync } from '../modules/sync/sync.service'
import { createExchangeSource, registerUser } from './helpers'

// enqueueAutoSync ist global (alle Pro-Nutzer). Wir prüfen gezielt die Quellen
// unserer Testnutzer. FAKE_PROVIDERS=true → Sync läuft inline und liefert SUCCESS.
async function runCount(userId: string): Promise<number> {
  const source = await prisma.portfolioSource.findFirst({ where: { userId } })
  if (!source) return 0
  return prisma.syncRun.count({ where: { sourceId: source.id } })
}

describe('Auto-Sync (Integration)', () => {
  it('synct Pro-Quellen, Free-Quellen nicht', async () => {
    const pro = await registerUser('autosync-pro') // registerUser → Default PRO
    await createExchangeSource(pro, 'Pro Kraken')
    const free = await registerUser('autosync-free', 'FREE')
    await createExchangeSource(free, 'Free Kraken')

    await enqueueAutoSync()

    expect(await runCount(pro.userId)).toBeGreaterThan(0)
    expect(await runCount(free.userId)).toBe(0)
    // enqueueAutoSync ist global: synct alle im Test-DB akkumulierten Pro-Quellen
    // inline (jede jetzt mit Multi-Konto + Futures) → großzügiges Timeout
  }, 30000)

  it('überspringt Pro-Nutzer mit autoSyncEnabled=false', async () => {
    const user = await registerUser('autosync-off') // PRO
    await prisma.user.update({ where: { id: user.userId }, data: { autoSyncEnabled: false } })
    await createExchangeSource(user, 'Off Kraken')

    await enqueueAutoSync()

    expect(await runCount(user.userId)).toBe(0)
  }, 30000)
})
