import type { Request, Response } from 'express'
import { env } from '../../config/env'
import { REFRESH_TTL_DAYS } from '../../lib/jwt'

// Refresh token transport: web uses an httpOnly cookie (unreadable to JS),
// native clients (Capacitor) send X-Client: native and continue to use
// body + encrypted Secure Storage — cross-origin cookies do not work reliably
// in the native WebView.

const COOKIE_NAME = 'rt'
const MAX_AGE_MS = REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000
// Restricted to the auth routes; the cookie is not sent anywhere else.
const COOKIE_PATH = '/api/v1/auth'

export function isNativeClient(req: Request): boolean {
  return req.get('X-Client') === 'native'
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.APP_ENV !== 'local', // local runs over http (localhost)
    sameSite: 'lax' as const,
    path: COOKIE_PATH,
  }
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: MAX_AGE_MS })
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions())
}

export function readRefreshToken(req: Request): string | undefined {
  // Native: from the body; web: from the httpOnly cookie
  if (isNativeClient(req)) {
    const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken
    return typeof fromBody === 'string' ? fromBody : undefined
  }
  return (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME]
}
