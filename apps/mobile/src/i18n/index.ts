import { createI18n } from 'vue-i18n'
import de from './locales/de'
import en from './locales/en'
import fr from './locales/fr'
import pl from './locales/pl'
import cs from './locales/cs'
import ru from './locales/ru'
import { getStored, setStored } from '../services/storage'

export const SUPPORTED_LOCALES = [
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'pl', name: 'Polski' },
  { code: 'cs', name: 'Čeština' },
  { code: 'ru', name: 'Русский' },
] as const
export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]['code']

const STORAGE_KEY = 'language'

function isSupported(code: string): code is LocaleCode {
  return SUPPORTED_LOCALES.some((l) => l.code === code)
}

// Stored choice → browser language → English
function detectLocale(): LocaleCode {
  const stored = getStored(STORAGE_KEY)
  if (stored && isSupported(stored)) return stored
  const browser = (navigator.language ?? '').toLowerCase().split('-')[0] ?? ''
  return isSupported(browser) ? browser : 'en'
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { de, en, fr, pl, cs, ru },
})

// For use outside of <script setup> (alerts, services)
export function t(key: string, params?: Record<string, unknown>): string {
  return params ? i18n.global.t(key, params) : i18n.global.t(key)
}

// i18n is created at import time — at that point the storage cache is
// still empty. After preloadStorage() in the bootstrap, reapply the stored
// language (without persisting again — it is detection, not a user choice).
export function applyDetectedLocale(): void {
  const code = detectLocale()
  i18n.global.locale.value = code
  document.documentElement.lang = code
}

export function getLocale(): LocaleCode {
  return i18n.global.locale.value as LocaleCode
}

export function setLocale(code: LocaleCode): void {
  i18n.global.locale.value = code
  setStored(STORAGE_KEY, code)
  document.documentElement.lang = code
}

// For Intl.NumberFormat / toLocaleString
const INTL_LOCALES: Record<LocaleCode, string> = {
  de: 'de-DE',
  en: 'en-US',
  fr: 'fr-FR',
  pl: 'pl-PL',
  cs: 'cs-CZ',
  ru: 'ru-RU',
}

export function intlLocale(): string {
  return INTL_LOCALES[getLocale()]
}
