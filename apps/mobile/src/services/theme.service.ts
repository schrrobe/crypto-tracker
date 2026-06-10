// Dark/Light-Mode: Default folgt dem System, manueller Override wird persistiert.
// In Meilenstein 9 (Capacitor) wird localStorage durch @capacitor/preferences ersetzt.

export type ThemePreference = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'theme-preference'

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function setThemePreference(pref: ThemePreference): void {
  localStorage.setItem(STORAGE_KEY, pref)
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
