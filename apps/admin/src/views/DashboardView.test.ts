import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'

vi.mock('../services/admin', () => ({
  adminApi: {
    overview: vi.fn(),
    growth: vi.fn(),
    churn: vi.fn(),
    activity: vi.fn(),
    attention: vi.fn(),
    health: vi.fn(),
  },
}))

// vue-chartjs components need a canvas; stub them out for the unit test.
vi.mock('vue-chartjs', () => ({ Line: { template: '<div />' }, Doughnut: { template: '<div />' } }))

import { adminApi } from '../services/admin'
import DashboardView from './DashboardView.vue'

type Fn = ReturnType<typeof vi.fn>
const api = adminApi as unknown as {
  overview: Fn; growth: Fn; churn: Fn; activity: Fn; attention: Fn; health: Fn
}

const OVERVIEW = {
  totalUsers: 10, proUsers: 2, freeUsers: 8, proRatePct: 20,
  newUsers7d: 3, newUsers30d: 9,
  newUsers7dDeltaPct: 50, newUsers30dDeltaPct: null,
  activeSessions: 4, activeSubscriptions: 2, mrrProxyCents: 1998,
  referral: { byCurrency: [], activeReferrers: 0, invitedUsers: 0 },
}
const EMPTY_ACTIVITY = { recentSignups: [], recentAudit: [] }

function mountView() {
  return mount(DashboardView, {
    global: {
      stubs: {
        RouterLink: RouterLinkStub,
        HealthBadges: true,
        AttentionPanel: true,
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.overview.mockResolvedValue(OVERVIEW)
  api.growth.mockResolvedValue({ points: [{ date: '2026-06-01', signups: 1, cumulative: 1 }] })
  api.churn.mockResolvedValue({ activePro: 2, expiredPro: 1, expiringSoon7d: 0, lapsed: [] })
  api.activity.mockResolvedValue(EMPTY_ACTIVITY)
  api.attention.mockResolvedValue({})
  api.health.mockResolvedValue({ checks: [], checkedAt: '' })
})

describe('DashboardView', () => {
  it('period switcher requests growth for the chosen range, leaves KPIs alone', async () => {
    const w = mountView()
    await flushPromises()
    api.growth.mockClear()
    const buttons = w.findAll('button[aria-label^="Zeitraum"]')
    const btn90 = buttons.find((b) => b.text().includes('90'))!
    await btn90.trigger('click')
    expect(api.growth).toHaveBeenCalledWith(90)
    expect(api.overview).toHaveBeenCalledTimes(1) // not re-fetched on range change
  })

  it('renders empty activity state when there is no activity', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).toContain('Keine.')
  })

  it('registration items link to the user detail route', async () => {
    api.activity.mockResolvedValue({
      recentSignups: [{ id: 'u1', email: 'a@b.de', plan: 'FREE', createdAt: '2026-06-01T10:00:00.000Z' }],
      recentAudit: [],
    })
    const w = mountView()
    await flushPromises()
    const link = w.findAllComponents(RouterLinkStub).find((l) => l.props('to') === '/users/u1')
    expect(link).toBeTruthy()
  })

  it('shows a stale badge when a refresh fails after data already loaded', async () => {
    const w = mountView()
    await flushPromises()
    expect(w.text()).not.toContain('Daten veraltet')
    api.overview.mockRejectedValueOnce(new Error('boom'))
    const refresh = w.findAll('button').find((b) => b.text().includes('Aktualisieren'))!
    await refresh.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Daten veraltet')
  })
})
