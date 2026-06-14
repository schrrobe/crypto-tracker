import jwt from 'jsonwebtoken'
import { createHash, randomBytes } from 'node:crypto'
import { env } from '../config/env'

const ACCESS_TTL_SECONDS = 15 * 60
export const REFRESH_TTL_DAYS = 30

export function signAccessToken(userId: string): string {
  return jwt.sign({}, env.JWT_SECRET, { subject: userId, expiresIn: ACCESS_TTL_SECONDS })
}

export function verifyAccessToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

// Refresh tokens are opaque (not JWTs); the DB stores only the hash.
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

// Keyed hash: a DB leak alone is not enough to forge valid tokens
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(`${env.JWT_REFRESH_SECRET}:${token}`).digest('hex')
}

// Password reset tokens: opaque, short TTL; as with the refresh token, the DB
// stores only the keyed hash. A dedicated prefix prevents confusing the token types.
export const PASSWORD_RESET_TTL_MINUTES = 30

export function generatePasswordResetToken(): string {
  return randomBytes(48).toString('base64url')
}

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(`pwreset:${env.JWT_REFRESH_SECRET}:${token}`).digest('hex')
}
