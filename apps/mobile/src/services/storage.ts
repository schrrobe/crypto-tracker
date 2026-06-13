import { Preferences } from '@capacitor/preferences'
import { SecureStorage } from '@aparajita/capacitor-secure-storage'

// Persistente Speicherung über Capacitor — funktioniert auf Web (Fallback auf
// localStorage) und nativ (iOS/Android). Sicherheitskritische Werte landen im
// verschlüsselten Secure Storage (iOS-Keychain / Android-Keystore), der Rest in
// @capacitor/preferences.
//
// Die Capacitor-Backends sind asynchron; der Startup-Pfad (Theme, Sprache,
// aktives Portfolio) liest aber synchron. Lösung: beim App-Bootstrap einmal
// preloadStorage() awaiten, das alle Keys in einen In-Memory-Cache lädt.
// get/set/remove arbeiten danach synchron gegen den Cache und persistieren
// write-through asynchron ins jeweilige Backend.

export type StorageKey =
  | 'refresh-token'
  | 'active-portfolio-id'
  | 'taxCountry'
  | 'language'
  | 'theme-preference'
  | 'balances-hidden'

const ALL_KEYS: StorageKey[] = [
  'refresh-token',
  'active-portfolio-id',
  'taxCountry',
  'language',
  'theme-preference',
  'balances-hidden',
]

// Nur der Refresh-Token ist sicherheitskritisch → verschlüsseltes Secure Storage.
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

// Einmal beim Bootstrap awaiten, bevor die App gemountet wird.
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
