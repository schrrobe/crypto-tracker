import { beforeEach, describe, expect, it } from 'vitest'
import { getStored, preloadStorage, removeStored, setStored } from './storage'

// Web-Pfad: Preferences + Secure-Storage nutzen beide localStorage als Fallback.
// Geprüft wird der synchrone Cache (set→get) und der Preload aus dem Backend.

beforeEach(() => localStorage.clear())

describe('storage-Abstraktion', () => {
  it('set schreibt synchron in den Cache, get liest ihn', () => {
    setStored('language', 'fr')
    expect(getStored('language')).toBe('fr')
  })

  it('remove leert den Wert', () => {
    setStored('taxCountry', 'AT')
    removeStored('taxCountry')
    expect(getStored('taxCountry')).toBeNull()
  })

  it('unbekannter/ungesetzter Key liefert null', () => {
    expect(getStored('active-portfolio-id')).toBeNull()
  })

  it('preload lädt persistierte Werte aus dem Backend in den Cache', async () => {
    // refresh-token über das verschlüsselte Backend persistieren …
    setStored('refresh-token', 'tok-123')
    // … bis die write-through-Persistenz durch ist
    await new Promise((r) => setTimeout(r, 10))
    await preloadStorage()
    expect(getStored('refresh-token')).toBe('tok-123')
  })
})
