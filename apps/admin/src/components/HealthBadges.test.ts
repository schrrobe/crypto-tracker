import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { AdminHealthDto } from '@crypto-tracker/shared'
import HealthBadges from './HealthBadges.vue'

describe('HealthBadges', () => {
  it('renders nothing without data', () => {
    const w = mount(HealthBadges, { props: { data: null } })
    expect(w.text()).toBe('')
  })

  it('maps each state to its dot color + latency/label', () => {
    const data: AdminHealthDto = {
      checkedAt: '2026-06-20T00:00:00.000Z',
      checks: [
        { name: 'database', state: 'ok', latencyMs: 3, detail: null },
        { name: 'coingecko', state: 'down', latencyMs: null, detail: 'HTTP 503' },
        { name: 'redis', state: 'skipped', latencyMs: null, detail: 'nicht gesetzt' },
      ],
    }
    const w = mount(HealthBadges, { props: { data } })
    const html = w.html()
    expect(html).toContain('bg-emerald-500') // ok
    expect(html).toContain('bg-red-500') // down
    expect(html).toContain('bg-slate-300') // skipped
    expect(w.text()).toContain('Datenbank')
    expect(w.text()).toContain('3ms') // ok latency shown
    expect(w.text()).toContain('down') // down state label
    expect(w.text()).toContain('n/a') // skipped state label
  })
})
