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

// Refresh-Tokens sind opak (kein JWT); in der DB liegt nur der Hash.
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

// Keyed Hash: ein reiner DB-Leak reicht nicht, um gültige Tokens zu fälschen
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(`${env.JWT_REFRESH_SECRET}:${token}`).digest('hex')
}
