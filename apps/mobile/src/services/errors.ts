import { ApiError } from './api.client'
import { i18n, t } from '../i18n'

// Lokalisiert API-Fehler über den stabilen error.code; unbekannte Codes fallen auf
// die Server-Message zurück, alles andere auf den übergebenen Fallback-Key.
export function apiErrorMessage(error: unknown, fallbackKey: string): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`
    if (i18n.global.te(key)) return t(key)
    return error.message
  }
  return t(fallbackKey)
}
