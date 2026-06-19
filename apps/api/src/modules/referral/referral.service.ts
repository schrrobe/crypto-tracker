import { randomBytes } from 'node:crypto'
import { env } from '../../config/env'
import { prisma } from '../../lib/prisma'
import { decryptSecret, encryptSecret, keyPreview } from '../../lib/crypto'
import { AppError } from '../../lib/errors'
import type {
  BankDetailsInput,
  ReferralBankDto,
  ReferralDto,
} from '@crypto-tracker/shared'

// Unambiguous alphabet (no 0/O/1/I) for human-shareable codes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LEN = 8
const COMMISSION_RATE = 0.2

function randomCode(): string {
  const bytes = randomBytes(CODE_LEN)
  let out = ''
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[bytes[i]! % ALPHABET.length]
  return out
}

// Generate a code that is not yet taken (retry on the unique constraint).
export async function generateUniqueReferralCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode()
    const existing = await prisma.user.findUnique({ where: { referralCode: code } })
    if (!existing) return code
  }
  throw new Error('Konnte keinen eindeutigen Referral-Code erzeugen')
}

// Resolve an invite code to the inviting user's id (null if unknown/blank).
export async function resolveReferrerId(code: string | undefined): Promise<string | null> {
  if (!code) return null
  const referrer = await prisma.user.findUnique({ where: { referralCode: code.trim() } })
  return referrer?.id ?? null
}

// Idempotently record a 20% commission for a paid Pro invoice of an invited user.
// Safe to call repeatedly for the same invoice (unique stripeInvoiceId).
export async function recordCommissionForInvoice(input: {
  referredUserId: string
  referrerId: string
  stripeInvoiceId: string
  amountPaidCents: number
  currency: string
}): Promise<void> {
  if (input.amountPaidCents <= 0) return
  const amountCents = Math.floor(input.amountPaidCents * COMMISSION_RATE)
  if (amountCents <= 0) return
  try {
    await prisma.referralCommission.create({
      data: {
        referrerId: input.referrerId,
        referredUserId: input.referredUserId,
        stripeInvoiceId: input.stripeInvoiceId,
        amountCents,
        currency: input.currency,
      },
    })
  } catch (e) {
    // Duplicate invoice (unique constraint) → already credited, ignore.
    if (isUniqueViolation(e)) return
    throw e
  }
}

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002')
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const head = local.slice(0, 1)
  return `${head}***@${domain}`
}

// Build the referral overview for a user, generating their code on first access.
export async function getReferralOverview(userId: string): Promise<ReferralDto> {
  let user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('User nicht gefunden')
  if (!user.referralCode) {
    user = await prisma.user.update({
      where: { id: userId },
      data: { referralCode: await generateUniqueReferralCode() },
    })
  }

  const invited = await prisma.user.findMany({
    where: { referredById: userId },
    select: { email: true, plan: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  const commissions = await prisma.referralCommission.findMany({
    where: { referrerId: userId, voidedAt: null },
    select: { amountCents: true, currency: true, payoutId: true },
  })
  const currency = commissions[0]?.currency ?? user.baseCurrency
  const owedCents = sumCents(commissions.filter((c) => c.payoutId === null))
  const paidCents = sumCents(commissions.filter((c) => c.payoutId !== null))

  return {
    code: user.referralCode!,
    link: `${env.APP_PUBLIC_URL}/register?ref=${user.referralCode}`,
    invitedCount: invited.length,
    earnings: { owedCents, paidCents, currency },
    invited: invited.map((i) => ({
      emailMasked: maskEmail(i.email),
      joinedAt: i.createdAt.toISOString(),
      isPro: i.plan === 'PRO',
    })),
  }
}

function sumCents(rows: { amountCents: number }[]): number {
  return rows.reduce((acc, r) => acc + r.amountCents, 0)
}

export async function getBankDetails(userId: string): Promise<ReferralBankDto | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user?.encryptedIban || !user.ibanPreview) return null
  return {
    holder: user.bankHolder ?? '',
    bic: user.bankBic ?? '',
    ibanPreview: user.ibanPreview,
  }
}

export async function saveBankDetails(userId: string, input: BankDetailsInput): Promise<ReferralBankDto> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      encryptedIban: encryptSecret(input.iban),
      ibanPreview: keyPreview(input.iban),
      bankBic: input.bic,
      bankHolder: input.holder,
    },
  })
  return { holder: input.holder, bic: input.bic, ibanPreview: keyPreview(input.iban) }
}

// --- Admin (payout) ---------------------------------------------------------

export interface PendingPayout {
  referrerId: string
  email: string
  owedCents: number
  currency: string
  holder: string | null
  bic: string | null
  iban: string | null // full, decrypted — admin only, for the bank transfer
}

// One pending payout per (referrer, currency) over all unpaid commissions.
export async function listPendingPayouts(): Promise<PendingPayout[]> {
  const grouped = await prisma.referralCommission.groupBy({
    by: ['referrerId', 'currency'],
    where: { payoutId: null, voidedAt: null },
    _sum: { amountCents: true },
  })
  const referrers = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.referrerId) } },
    select: { id: true, email: true, bankHolder: true, bankBic: true, encryptedIban: true },
  })
  const byId = new Map(referrers.map((r) => [r.id, r]))
  return grouped.map((g) => {
    const u = byId.get(g.referrerId)
    return {
      referrerId: g.referrerId,
      email: u?.email ?? '',
      owedCents: g._sum.amountCents ?? 0,
      currency: g.currency,
      holder: u?.bankHolder ?? null,
      bic: u?.bankBic ?? null,
      iban: u?.encryptedIban ? decryptSecret(u.encryptedIban) : null,
    }
  })
}

// Bundle a referrer's unpaid commissions (one currency) into a Payout, marking them paid.
export async function settlePayout(referrerId: string, currency: string): Promise<{ id: string; amountCents: number; currency: string }> {
  return prisma.$transaction(async (tx) => {
    const unpaid = await tx.referralCommission.findMany({
      where: { referrerId, currency, payoutId: null, voidedAt: null },
      select: { id: true, amountCents: true },
    })
    if (unpaid.length === 0) throw AppError.notFound('Keine offenen Kommissionen')
    const amountCents = unpaid.reduce((acc, c) => acc + c.amountCents, 0)
    const payout = await tx.payout.create({
      data: { referrerId, amountCents, currency },
    })
    await tx.referralCommission.updateMany({
      where: { id: { in: unpaid.map((c) => c.id) } },
      data: { payoutId: payout.id },
    })
    return { id: payout.id, amountCents, currency }
  })
}
