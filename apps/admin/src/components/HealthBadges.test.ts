import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DisplayCheck } from '../composables/useHealth'
import HealthBadges from './HealthBadges.vue'

const checks: DisplayCheck[] = [
  { name: 'coingecko', state: 'down', latencyMs: null, detail: 'HTTP 503' },
  { name: 'database', state: 'ok', latencyMs: 3, detail: null },
  { name: 'redis', state: 'skipped', latencyMs: null, detail: 'nicht gesetzt' },
]

describe('HealthBadges', () => {
  it('renders skeleton pills while loading, no badges', () => {
    const w = mount(HealthBadges, { props: { checks: [], loading: true } })
    expect(w.findAll('.animate-pulse')).toHaveLength(4)
    expect(w.text()).toBe('')
  })

  it('maps each state to its dot color, label and impact', () => {
    const w = mount(HealthBadges, { props: { checks } })
    const html = w.html()
    expect(html).toContain('bg-emerald-500') // ok
    expect(html).toContain('bg-red-500') // down
    expect(html).toContain('bg-slate-300') // skipped
    expect(w.text()).toContain('Datenbank')
    expect(w.text()).toContain('3ms') // ok latency shown
    expect(w.text()).toContain('nicht erreichbar') // down suffix
    expect(w.text()).toContain('Preise können veraltet sein') // down impact, visible (not tooltip)
    expect(w.text()).toContain('nicht konfiguriert') // skipped suffix
  })

  it('dims the row when the last tick is stale', () => {
    const fresh = mount(HealthBadges, { props: { checks } })
    expect(fresh.find('.opacity-50').exists()).toBe(false)
    const stale = mount(HealthBadges, { props: { checks, stale: true } })
    expect(stale.find('.opacity-50').exists()).toBe(true)
  })
})
