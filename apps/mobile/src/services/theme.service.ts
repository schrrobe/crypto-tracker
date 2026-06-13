// Dark/Light-Mode: Default folgt dem System, manueller Override wird persistiert
// (über die Storage-Abstraktion: Web = localStorage, nativ = Preferences).

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

  // Bei "system" auf Änderungen des OS-Themes reagieren
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
