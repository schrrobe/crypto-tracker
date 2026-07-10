import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { AdminHealthDto } from '@crypto-tracker/shared'

const health = vi.fn()
vi.mock('../services/admin', () => ({ adminApi: { health: (): Promise<AdminHealthDto> => health() } }))

// Import after the mock is registered.
const { useHealth } = await import('./useHealth')

function dto(checks: AdminHealthDto['checks']): AdminHealthDto {
  return { checks, checkedAt: '2026-06-27T00:00:00.000Z' }
}

beforeEach(() => health.mockReset())

describe('useHealth', () => {
  it('starts in loading with a "wird geprüft" verdict', () => {
    const h = useHealth()
    expect(h.loading.value).toBe(true)
    expect(h.overall.value.level).toBe('loading')
  })

  it('derives degraded from latency: internal >1s, external >2.5s', async () => {
    health.mockResolvedValue(
      dto([
        { name: 'database', state: 'ok', latencyMs: 1500, detail: null }, // >1s internal -> degraded
        { name: 'redis', state: 'ok', latencyMs: 200, detail: null }, // fast -> ok
        { name: 'coingecko', state: 'ok', latencyMs: 2000, detail: null }, // <2.5s external -> ok
        { name: 'smtp', state: 'ok', latencyMs: 3000, detail: null }, // >2.5s external -> degraded
      ]),
    )
    const h = useHealth()
    await h.refresh()
    const byName = Object.fromEntries(h.checks.value.map((c) => [c.name, c.state]))
    expect(byName).toEqual({ database: 'degraded', redis: 'ok', coingecko: 'ok', smtp: 'degraded' })
    expect(h.overall.value).toEqual({ level: 'degraded', label: 'Betrieb eingeschränkt' })
  })

  it('counts down services in the overall verdict and sorts them first', async () => {
    health.mockResolvedValue(
      dto([
        { name: 'database', state: 'ok', latencyMs: 5, detail: null },
        { name: 'redis', state: 'down', latencyMs: null, detail: 'PING timeout' },
        { name: 'coingecko', state: 'down', latencyMs: null, detail: 'HTTP 503' },
        { name: 'smtp', state: 'skipped', latencyMs: null, detail: 'nicht konfiguriert' },
      ]),
    )
    const h = useHealth()
    await h.refresh()
    expect(h.overall.value).toEqual({ level: 'down', label: '2 von 4 Diensten gestört' })
    expect(h.sortedChecks.value.map((c) => c.state)).toEqual(['down', 'down', 'ok', 'skipped'])
  })

  it('reports a calm verdict when every check is skipped', async () => {
    health.mockResolvedValue(
      dto([
        { name: 'redis', state: 'skipped', latencyMs: null, detail: null },
        { name: 'coingecko', state: 'skipped', latencyMs: null, detail: null },
        { name: 'smtp', state: 'skipped', latencyMs: null, detail: null },
        { name: 'database', state: 'skipped', latencyMs: null, detail: null },
      ]),
    )
    const h = useHealth()
    await h.refresh()
    expect(h.overall.value.level).toBe('skipped')
  })

  it('keeps prior values and flags stale when a tick fails', async () => {
    health.mockResolvedValueOnce(dto([{ name: 'database', state: 'ok', latencyMs: 4, detail: null }]))
    const h = useHealth()
    await h.refresh()
    expect(h.isStale.value).toBe(false)
    expect(h.lastSuccessAt.value).not.toBeNull()
    const firstSuccess = h.lastSuccessAt.value

    health.mockRejectedValueOnce(new Error('network'))
    await h.refresh()
    expect(h.isStale.value).toBe(true) // marked stale
    expect(h.checks.value).toHaveLength(1) // prior values retained
    expect(h.lastSuccessAt.value).toBe(firstSuccess) // success time not advanced
    expect(h.refreshing.value).toBe(false)
  })
})
