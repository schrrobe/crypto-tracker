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
import { cancelSubscription } from '../billing/billing.service'
import { generateUniqueReferralCode, resolveReferrerId } from '../referral/referral.service'

export interface UserDto {
  id: string
  email: string
  baseCurrency: string
  plan: 'FREE' | 'PRO'
  isAdmin: boolean
  autoSyncEnabled: boolean
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
  isAdmin: boolean
  autoSyncEnabled: boolean
  createdAt: Date
}): UserDto {
  return {
    id: user.id,
    email: user.email,
    baseCurrency: user.baseCurrency,
    plan: user.plan,
    isAdmin: user.isAdmin,
    autoSyncEnabled: user.autoSyncEnabled,
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

export async function register(
  email: string,
  password: string,
  referralCode?: string,
): Promise<AuthResult> {
  const normalizedEmail = email.toLowerCase().trim()
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } })
  if (existing) {
    throw AppError.conflict('EMAIL_TAKEN', 'Diese E-Mail-Adresse ist bereits registriert')
  }
  // Attribute the invite (unknown codes are silently ignored) and mint an own code.
  const referredById = await resolveReferrerId(referralCode)
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash: await argon2.hash(password),
      referralCode: await generateUniqueReferralCode(),
      referredById,
      // Default portfolio eagerly — scoped endpoints without a portfolioId land here
      portfolios: { create: { label: 'Mein Portfolio', isDefault: true } },
    },
  })
  return { user: toUserDto(user), ...(await issueTokens(user.id)) }
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
  // Deliberately the same error message for "user does not exist" and "wrong password"
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
  // Simple rotation: the old token is invalidated, a new one is issued
  await prisma.refreshToken.delete({ where: { id: stored.id } })
  return { user: toUserDto(stored.user), ...(await issueTokens(stored.userId)) }
}

export async function logout(refreshToken: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { tokenHash: hashRefreshToken(refreshToken) } })
}

// Initiate reset: if the email exists, a one-time token is generated and the
// link is sent (or written to the log). Responds identically on purpose —
// no disclosure of whether the address is registered (no user enumeration).
export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
  if (!user) return

  // Invalidate the user's outstanding tokens — only the newest one is valid per request
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

// Complete reset: verify the token, set the password, consume the token, and end all
// active sessions (delete refresh tokens).
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
    // Security: end existing sessions after a password change
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
  data: { baseCurrency?: string; plan?: 'FREE' | 'PRO'; autoSyncEnabled?: boolean },
): Promise<UserDto> {
  // plan is only changeable in local mode (dev switch for testing gating without
  // Stripe); in dev/prod the plan is set exclusively via the Stripe webhook.
  const allowPlan = env.APP_ENV === 'local'
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      baseCurrency: data.baseCurrency,
      ...(data.autoSyncEnabled !== undefined ? { autoSyncEnabled: data.autoSyncEnabled } : {}),
      ...(allowPlan && data.plan ? { plan: data.plan } : {}),
    },
  })
  return toUserDto(user)
}

// Permanently delete the account (store requirement). Explicit ordering within a
// transaction: sources first (holdings/transactions/imports/credentials cascade
// off them), then portfolios (otherwise the Restrict FK PortfolioSource→Portfolio
// kicks in), then the user itself (tokens cascade).
export async function deleteAccount(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { stripeSubscriptionId: true },
  })
  // Cancel the Stripe subscription BEFORE the user (and thus the customer mapping)
  // is deleted — otherwise billing keeps running and the downgrade webhook can no
  // longer find the user. A Stripe error must not block account deletion (store
  // requirement): only log it so the subscription can be ended manually.
  if (user?.stripeSubscriptionId) {
    try {
      await cancelSubscription(user.stripeSubscriptionId)
    } catch (error) {
      console.error(
        `Stripe-Abo ${user.stripeSubscriptionId} bei Konto-Löschung nicht gekündigt:`,
        error instanceof Error ? error.message : error,
      )
    }
  }
  await prisma.$transaction([
    prisma.portfolioSource.deleteMany({ where: { userId } }),
    prisma.portfolio.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ])
}
