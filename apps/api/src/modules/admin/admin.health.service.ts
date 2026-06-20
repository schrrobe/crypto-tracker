import type { AdminHealthCheckDto, AdminHealthDto, HealthState } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { env } from '../../config/env'
import { mailerConfigured, verifySmtp } from '../../lib/mailer'
import { pingRedis } from '../sync/sync.queue'

const COINGECKO_PING = 'https://api.coingecko.com/api/v3/ping'
const TIMEOUT_MS = 5000

type CheckName = AdminHealthCheckDto['name']

// Run a probe with timing + timeout. Resolves to a check result, never throws.
async function probe(name: CheckName, fn: (signal: AbortSignal) => Promise<void>): Promise<AdminHealthCheckDto> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const start = Date.now()
  try {
    await fn(controller.signal)
    return { name, state: 'ok', latencyMs: Date.now() - start, detail: null }
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 200) : 'unbekannter Fehler'
    return { name, state: 'down', latencyMs: Date.now() - start, detail }
  } finally {
    clearTimeout(timer)
  }
}

function skipped(name: CheckName, detail: string): AdminHealthCheckDto {
  return { name, state: 'skipped' as HealthState, latencyMs: null, detail }
}

export async function getHealth(): Promise<AdminHealthDto> {
  const checks = await Promise.all([
    probe('database', async () => {
      await prisma.$queryRaw`SELECT 1`
    }),
    env.REDIS_URL
      ? probe('redis', async () => {
          await pingRedis()
        })
      : Promise.resolve(skipped('redis', 'REDIS_URL nicht gesetzt')),
    env.FAKE_PRICES
      ? Promise.resolve(skipped('coingecko', 'Fake-Modus aktiv'))
      : probe('coingecko', async (signal) => {
          const res = await fetch(COINGECKO_PING, {
            signal,
            headers: env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : {},
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
        }),
    mailerConfigured
      ? probe('smtp', async () => {
          await verifySmtp()
        })
      : Promise.resolve(skipped('smtp', 'SMTP nicht konfiguriert')),
  ])
  return { checks, checkedAt: new Date().toISOString() }
}
