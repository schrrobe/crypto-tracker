import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { AdminAttentionDto } from '@crypto-tracker/shared'
import AttentionPanel from './AttentionPanel.vue'

const ZERO: AdminAttentionDto = {
  sourcesInError: 0,
  failedImports: 0,
  stalePriceCache: 0,
  expiringSoonPro: 0,
  suspendedUsers: 0,
}

// $router.push is only called on click; render-only tests need no real router,
// but stub RouterLink-free template by providing a no-op $router via global mocks.
const global = { mocks: { $router: { push: () => {} } } }

describe('AttentionPanel', () => {
  it('shows all-clear when data is null', () => {
    const w = mount(AttentionPanel, { props: { data: null }, global })
    expect(w.text()).toContain('Alles im grünen Bereich')
  })

  it('shows all-clear when every counter is 0', () => {
    const w = mount(AttentionPanel, { props: { data: ZERO }, global })
    expect(w.text()).toContain('Alles im grünen Bereich')
    expect(w.findAll('li')).toHaveLength(0)
  })

  it('renders only counters > 0 as rows', () => {
    const data: AdminAttentionDto = { ...ZERO, sourcesInError: 2, suspendedUsers: 1 }
    const w = mount(AttentionPanel, { props: { data }, global })
    expect(w.text()).not.toContain('Alles im grünen Bereich')
    const rows = w.findAll('li')
    expect(rows).toHaveLength(2)
    expect(w.text()).toContain('Quellen im Fehlerstatus')
    expect(w.text()).toContain('Gesperrte Konten')
    expect(w.text()).not.toContain('Offene Auszahlungen')
    // red severity dot for sourcesInError
    expect(w.html()).toContain('bg-red-500')
  })
})
