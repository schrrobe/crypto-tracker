import { beforeEach, describe, expect, it } from 'vitest'
import { getStored, preloadStorage, removeStored, setStored } from './storage'

// Web path: Preferences + Secure Storage both use localStorage as a fallback.
// We check the synchronous cache (set→get) and the preload from the backend.

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
    // persist refresh-token via the encrypted backend …
    setStored('refresh-token', 'tok-123')
    // … until the write-through persistence has completed
    await new Promise((r) => setTimeout(r, 10))
    await preloadStorage()
    expect(getStored('refresh-token')).toBe('tok-123')
  })
})
