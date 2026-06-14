import { ApiError } from './api.client'
import { i18n, t } from '../i18n'

// Localizes API errors via the stable error.code; unknown codes fall back to
// the server message, everything else to the provided fallback key.
export function apiErrorMessage(error: unknown, fallbackKey: string): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`
    if (i18n.global.te(key)) return t(key)
    return error.message
  }
  return t(fallbackKey)
}
