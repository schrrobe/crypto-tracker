import argon2 from 'argon2'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import {
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TTL_DAYS,
  signAccessToken,
} from '../../lib/jwt'

export interface UserDto {
  id: string
  email: string
  baseCurrency: string
  createdAt: string
}

interface AuthResult {
  user: UserDto
  accessToken: string
  refreshToken: string
}

function toUserDto(user: { id: string; email: string; baseCurrency: string; createdAt: Date }): UserDto {
  return {
    id: user.id,
    email: user.email,
    baseCurrency: user.baseCurrency,
    createdAt: user.createdAt.toISOString(),
  }
}

async function issueTokens(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
  const refreshToken = generateRefreshToken()
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  })
  return { accessToken: signAccessToken(userId), refreshToken }
}

export async function register(email: string, password: string): Promise<AuthResult> {
  const normalizedEmail = email.toLowerCase().trim()
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (existing) {
    throw AppError.conflict('EMAIL_TAKEN', 'Diese E-Mail-Adresse ist bereits registriert')
  }
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash: await argon2.hash(password),
      // Default-Portfolio eager — gescopte Endpunkte ohne portfolioId landen hier
      portfolios: { create: { label: 'Mein Portfolio', isDefault: true } },
    },
  })
  return { user: toUserDto(user), ...(await issueTokens(user.id)) }
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
  // Bewusst dieselbe Fehlermeldung für "User existiert nicht" und "Passwort falsch"
  const invalid = AppError.unauthorized('E-Mail oder Passwort ist falsch')
  if (!user) throw invalid
  const ok = await argon2.verify(user.passwordHash, password)
  if (!ok) throw invalid
  return { user: toUserDto(user), ...(await issueTokens(user.id)) }
}

export async function refresh(refreshToken: string): Promise<AuthResult> {
  const tokenHash = hashRefreshToken(refreshToken)
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  })
  if (!stored || stored.expiresAt < new Date()) {
    throw AppError.unauthorized('Sitzung abgelaufen, bitte neu anmelden')
  }
  // Einfache Rotation: alter Token wird ungültig, neuer wird ausgegeben
  await prisma.refreshToken.delete({ where: { id: stored.id } })
  return { user: toUserDto(stored.user), ...(await issueTokens(stored.userId)) }
}

export async function logout(refreshToken: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { tokenHash: hashRefreshToken(refreshToken) } })
}

export async function getMe(userId: string): Promise<UserDto> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw AppError.unauthorized()
  return toUserDto(user)
}

export async function updateMe(userId: string, data: { baseCurrency?: string }): Promise<UserDto> {
  const user = await prisma.user.update({ where: { id: userId }, data })
  return toUserDto(user)
}
