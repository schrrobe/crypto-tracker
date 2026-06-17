import { describe, expect, it } from 'vitest'
import { compareVersions } from './version'

describe('compareVersions', () => {
  it('treats equal versions as equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('detects older / newer per segment', () => {
    expect(compareVersions('1.2.0', '1.2.1')).toBe(-1)
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
  })

  it('pads missing segments with 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('1.2', '1.2.1')).toBe(-1)
    expect(compareVersions('1', '1.0.0')).toBe(0)
  })

  it('throws on unparseable input so callers can fail-open', () => {
    expect(() => compareVersions('', '1.0.0')).toThrow()
    expect(() => compareVersions('1.x.0', '1.0.0')).toThrow()
    expect(() => compareVersions('abc', '1.0.0')).toThrow()
  })
})
