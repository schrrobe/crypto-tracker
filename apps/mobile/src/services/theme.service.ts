// Dark/light mode: the default follows the system, a manual override is persisted
// (via the storage abstraction: web = localStorage, native = Preferences).

import { getStored, setStored } from './storage'

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme-preference'

export function getThemePreference(): ThemePreference {
  const stored = getStored(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function setThemePreference(pref: ThemePreference): void {
  setStored(STORAGE_KEY, pref)
  applyTheme(pref)
}

export function applyStoredTheme(): void {
  applyTheme(getThemePreference())

  // On "system", react to changes of the OS theme
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePreference() === 'system') applyTheme('system')
  })
}

function applyTheme(pref: ThemePreference): void {
  const dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('ion-palette-dark', dark)
}
