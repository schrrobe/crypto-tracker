import { describe, expect, it } from 'vitest'
import { fromBaseUnits } from './decimal'

describe('fromBaseUnits', () => {
  it('konvertiert Satoshi → BTC', () => {
    expect(fromBaseUnits(123456789n, 8)).toBe('1.23456789')
    expect(fromBaseUnits(100000000n, 8)).toBe('1')
    expect(fromBaseUnits(1n, 8)).toBe('0.00000001')
    expect(fromBaseUnits(0n, 8)).toBe('0')
  })

  it('konvertiert Lamports → SOL', () => {
    expect(fromBaseUnits(2500000000n, 9)).toBe('2.5')
    expect(fromBaseUnits(999999999n, 9)).toBe('0.999999999')
  })

  it('entfernt trailing zeros', () => {
    expect(fromBaseUnits(150000000n, 8)).toBe('1.5')
  })

  it('decimals=0 bleibt ganzzahlig', () => {
    expect(fromBaseUnits(42n, 0)).toBe('42')
  })

  it('verkraftet sehr große Werte verlustfrei (jenseits von Number)', () => {
    expect(fromBaseUnits(2100000000000000123n, 8)).toBe('21000000000.00000123')
  })

  it('negative Werte', () => {
    expect(fromBaseUnits(-150000000n, 8)).toBe('-1.5')
  })
})
