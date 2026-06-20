import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import KpiCard from './KpiCard.vue'

describe('KpiCard', () => {
  it('renders label, value and sub', () => {
    const w = mount(KpiCard, { props: { label: 'Nutzer', value: 42, sub: '12 Pro' } })
    expect(w.text()).toContain('Nutzer')
    expect(w.text()).toContain('42')
    expect(w.text()).toContain('12 Pro')
  })

  it('shows ▲ + green for positive delta', () => {
    const w = mount(KpiCard, { props: { label: 'x', value: 1, delta: 12 } })
    expect(w.text()).toContain('▲')
    expect(w.text()).toContain('12%')
    expect(w.html()).toContain('text-emerald-600')
  })

  it('shows ▼ + red for negative delta', () => {
    const w = mount(KpiCard, { props: { label: 'x', value: 1, delta: -5 } })
    expect(w.text()).toContain('▼')
    expect(w.text()).toContain('5%')
    expect(w.html()).toContain('text-red-600')
  })

  it('renders no delta arrow when delta is null or undefined', () => {
    const wNull = mount(KpiCard, { props: { label: 'x', value: 1, delta: null } })
    expect(wNull.text()).not.toContain('▲')
    expect(wNull.text()).not.toContain('▼')
    const wUndef = mount(KpiCard, { props: { label: 'x', value: 1 } })
    expect(wUndef.text()).not.toContain('▲')
    expect(wUndef.text()).not.toContain('▼')
  })
})
