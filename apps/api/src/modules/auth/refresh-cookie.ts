import type { Request, Response } from 'express'
import { env } from '../../config/env'
import { REFRESH_TTL_DAYS } from '../../lib/jwt'

// Refresh-Token-Transport: Web nutzt ein httpOnly-Cookie (für JS unlesbar),
// native Clients (Capacitor) senden X-Client: native und nutzen weiterhin
// Body + verschlüsseltes Secure Storage — Cross-Origin-Cookies funktionieren im
// nativen WebView nicht zuverlässig.

const COOKIE_NAME = 'rt'
const MAX_AGE_MS = REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000
// Auf die Auth-Routen begrenzt; das Cookie wird nirgends sonst mitgesendet.
const COOKIE_PATH = '/api/v1/auth'

export function isNativeClient(req: Request): boolean {
  return req.get('X-Client') === 'native'
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.APP_ENV !== 'local', // local läuft über http (localhost)
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
  // Nativ: aus dem Body; Web: aus dem httpOnly-Cookie
  if (isNativeClient(req)) {
    const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken
    return typeof fromBody === 'string' ? fromBody : undefined
  }
  return (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME]
}
