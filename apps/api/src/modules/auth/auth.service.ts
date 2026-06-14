import argon2 from 'argon2'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import {
  generatePasswordResetToken,
  generateRefreshToken,
  hashPasswordResetToken,
  hashRefreshToken,
  PASSWORD_RESET_TTL_MINUTES,
  REFRESH_TTL_DAYS,
  signAccessToken,
} from '../../lib/jwt'
import { sendMail } from '../../lib/mailer'
import { env } from '../../config/env'

export interface UserDto {
  id: string
  email: string
  baseCurrency: string
  plan: 'FREE' | 'PRO'
  createdAt: string
}

export interface AuthResult {
  user: UserDto
  accessToken: string
  refreshToken: string
}

function toUserDto(user: {
  id: string
  email: string
  baseCurrency: string
  plan: 'FREE' | 'PRO'
  createdAt: Date
}): UserDto {
  return {
    id: user.id,
    email: user.email,
    baseCurrency: user.baseCurrency,
    plan: user.plan,
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

// Reset anstoßen: existiert die E-Mail, wird ein Einmal-Token erzeugt und der
// Link versendet (bzw. ins Log geschrieben). Antwortet bewusst immer gleich —
// keine Auskunft, ob die Adresse registriert ist (keine User-Enumeration).
export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
  if (!user) return

  // Offene Tokens des Nutzers entwerten — pro Anforderung gilt nur der neueste
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } })

  const token = generatePasswordResetToken()
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashPasswordResetToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
    },
  })

  const resetUrl = `${env.APP_PUBLIC_URL}/reset-password?token=${token}`
  await sendMail({
    to: user.email,
    subject: 'Passwort zurücksetzen — Crypto Tracker',
    text:
      `Du hast einen Passwort-Reset angefordert.\n\n` +
      `Öffne diesen Link, um ein neues Passwort zu setzen (gültig ${PASSWORD_RESET_TTL_MINUTES} Minuten):\n` +
      `${resetUrl}\n\n` +
      `Wenn du das nicht warst, ignoriere diese E-Mail — dein Passwort bleibt unverändert.`,
  })
}

// Reset abschließen: Token prüfen, Passwort setzen, Token verbrauchen und alle
// aktiven Sitzungen beenden (Refresh-Tokens löschen).
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashPasswordResetToken(token) },
  })
  if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
    throw AppError.badRequest('INVALID_RESET_TOKEN', 'Der Link ist ungültig oder abgelaufen')
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: stored.userId },
      data: { passwordHash: await argon2.hash(newPassword) },
    }),
    prisma.passwordResetToken.update({ where: { id: stored.id }, data: { usedAt: new Date() } }),
    // Sicherheit: bestehende Sessions nach Passwortwechsel beenden
    prisma.refreshToken.deleteMany({ where: { userId: stored.userId } }),
  ])
}

export async function getMe(userId: string): Promise<UserDto> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw AppError.unauthorized()
  return toUserDto(user)
}

export async function updateMe(
  userId: string,
  data: { baseCurrency?: string; plan?: 'FREE' | 'PRO' },
): Promise<UserDto> {
  // plan nur im local-Modus änderbar (Dev-Schalter zum Testen des Gatings ohne
  // Stripe); in dev/prod wird der Plan ausschließlich per Stripe-Webhook gesetzt.
  const allowPlan = env.APP_ENV === 'local'
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      baseCurrency: data.baseCurrency,
      ...(allowPlan && data.plan ? { plan: data.plan } : {}),
    },
  })
  return toUserDto(user)
}

// Konto endgültig löschen (Store-Pflicht). Explizite Reihenfolge in einer
// Transaktion: Quellen zuerst (Holdings/Transaktionen/Imports/Credentials hängen
// per Cascade dran), dann Portfolios (sonst greift der Restrict-FK
// PortfolioSource→Portfolio), dann der User selbst (Tokens kaskadieren).
export async function deleteAccount(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.portfolioSource.deleteMany({ where: { userId } }),
    prisma.portfolio.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ])
}
