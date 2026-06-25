import { Preferences } from '@capacitor/preferences'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'

// Persistent storage via Capacitor — works on web (fallback to localStorage)
// and native (iOS/Android). Security-critical values land in the encrypted
// Secure Storage (iOS Keychain / Android Keystore), the rest in
// @capacitor/preferences.
//
// The Capacitor backends are asynchronous; the startup path (theme, language,
// active portfolio) however reads synchronously. Solution: at app bootstrap,
// await preloadStorage() once, which loads all keys into an in-memory cache.
// get/set/remove then work synchronously against the cache and persist
// write-through asynchronously to the respective backend.

export type StorageKey =
  | 'refresh-token'
  | 'active-portfolio-id'
  | 'taxCountry'
  | 'language'
  | 'theme-preference'
  | 'balances-hidden'
  | 'dismissed-announcements'

const ALL_KEYS: StorageKey[] = [
  'refresh-token',
  'active-portfolio-id',
  'taxCountry',
  'language',
  'theme-preference',
  'balances-hidden',
  'dismissed-announcements',
]

// Only the refresh token is security-critical → encrypted Secure Storage.
const SECURE_KEYS = new Set<StorageKey>(['refresh-token'])

const cache = new Map<StorageKey, string | null>()
let preloaded = false

async function backendGet(key: StorageKey): Promise<string | null> {
  if (SECURE_KEYS.has(key)) {
    const value = await SecureStorage.getItem(key)
    return typeof value === 'string' ? value : null
  }
  const { value } = await Preferences.get({ key })
  return value
}

async function backendSet(key: StorageKey, value: string): Promise<void> {
  if (SECURE_KEYS.has(key)) {
    await SecureStorage.setItem(key, value)
    return
  }
  await Preferences.set({ key, value })
}

async function backendRemove(key: StorageKey): Promise<void> {
  if (SECURE_KEYS.has(key)) {
    await SecureStorage.removeItem(key)
    return
  }
  await Preferences.remove({ key })
}

// Await once at bootstrap, before the app is mounted.
export async function preloadStorage(): Promise<void> {
  if (preloaded) return
  await Promise.all(
    ALL_KEYS.map(async (key) => {
      try {
        cache.set(key, await backendGet(key))
      } catch {
        cache.set(key, null)
      }
    }),
  )
  preloaded = true
}

export function getStored(key: StorageKey): string | null {
  return cache.get(key) ?? null
}

export function setStored(key: StorageKey, value: string): void {
  cache.set(key, value)
  void backendSet(key, value).catch((err) =>
    console.warn(`[storage] Schreiben von ${key} fehlgeschlagen:`, err),
  )
}

export function removeStored(key: StorageKey): void {
  cache.set(key, null)
  void backendRemove(key).catch((err) =>
    console.warn(`[storage] Löschen von ${key} fehlgeschlagen:`, err),
  )
}
