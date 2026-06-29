import { randomBytes } from 'node:crypto'
import { env } from '../../config/env'
import { prisma } from '../../lib/prisma'
import { decryptSecret, encryptSecret, keyPreview } from '../../lib/crypto'
import { AppError } from '../../lib/errors'
import type {
  BankDetailsInput,
  ReferralBankDto,
  ReferralDto,
  ReferralEarningsDto,
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
// netAmountCents must be the NET (ex-VAT, ex-discount) revenue — never the gross
// amount_paid — so we never pay commission on tax we remit to the state.
// The commission starts PENDING and only becomes payable after the clearing window.
export async function recordCommissionForInvoice(input: {
  referredUserId: string
  referrerId: string
  stripeInvoiceId: string
  netAmountCents: number
  currency: string
  stripeChargeId?: string | null
  stripeSubscriptionId?: string | null
}): Promise<void> {
  // Self-referral guard: a user can never earn a commission on their own payment.
  if (input.referrerId === input.referredUserId) return
  if (input.netAmountCents <= 0) return
  const amountCents = Math.floor(input.netAmountCents * COMMISSION_RATE)
  if (amountCents <= 0) return
  const payableAt = new Date(Date.now() + env.REFERRAL_CLEARING_DAYS * 24 * 60 * 60 * 1000)
  try {
    await prisma.referralCommission.create({
      data: {
        referrerId: input.referrerId,
        referredUserId: input.referredUserId,
        stripeInvoiceId: input.stripeInvoiceId,
        stripeChargeId: input.stripeChargeId ?? null,
        stripeSubscriptionId: input.stripeSubscriptionId ?? null,
        amountCents,
        currency: input.currency,
        status: 'PENDING',
        payableAt,
      },
    })
  } catch (e) {
    // Duplicate invoice (unique constraint) → already credited, ignore.
    if (isUniqueViolation(e)) return
    throw e
  }
}

// Reverse (claw back) a commission when the underlying payment is refunded,
// disputed, or the invoice is voided. Idempotent. If the commission was already
// paid out, it is still marked REVERSED — the resulting negative balance must be
// surfaced to the admin (the money already left). Matches by invoice or charge id.
export async function reverseCommission(input: {
  stripeInvoiceId?: string | null
  stripeChargeId?: string | null
  reason: string
}): Promise<{ reversed: boolean; alreadyPaid: boolean }> {
  const where = input.stripeInvoiceId
    ? { stripeInvoiceId: input.stripeInvoiceId }
    : input.stripeChargeId
      ? { stripeChargeId: input.stripeChargeId }
      : null
  if (!where) return { reversed: false, alreadyPaid: false }
  const commission = await prisma.referralCommission.findFirst({ where })
  if (!commission) return { reversed: false, alreadyPaid: false }
  if (commission.status === 'REVERSED') return { reversed: false, alreadyPaid: Boolean(commission.payoutId) }
  const alreadyPaid = Boolean(commission.payoutId)
  await prisma.referralCommission.update({
    where: { id: commission.id },
    data: { status: 'REVERSED', reversedAt: new Date(), reversalReason: input.reason },
  })
  if (alreadyPaid) {
    // Money already left in payout `payoutId`; reversing now creates a negative
    // balance the admin must reclaim manually. Loud, alertable log — there is no
    // automatic clawback of a sent bank transfer.
    console.error(
      `[referral] REVERSAL_AFTER_PAYOUT commission=${commission.id} referrer=${commission.referrerId} ` +
        `payout=${commission.payoutId} amount=${commission.amountCents} ${commission.currency} reason=${input.reason} ` +
        `— admin must reclaim; referrer balance is now negative`,
    )
  }
  return { reversed: true, alreadyPaid }
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

  const earnings = await earningsByCurrency(userId)

  return {
    code: user.referralCode!,
    link: `${env.APP_PUBLIC_URL}/register?ref=${user.referralCode}`,
    invitedCount: invited.length,
    earnings,
    invited: invited.map((i) => ({
      emailMasked: maskEmail(i.email),
      joinedAt: i.createdAt.toISOString(),
      isPro: i.plan === 'PRO',
    })),
  }
}

// Per-currency earnings split by lifecycle. REVERSED commissions are excluded.
//   pending = not yet payable (inside clearing window), not paid
//   owed    = payable (clearing passed), not yet in a payout
//   paid    = settled into a payout
export async function earningsByCurrency(referrerId: string): Promise<ReferralEarningsDto[]> {
  const now = new Date()
  const live = { referrerId, status: { not: 'REVERSED' as const } }
  const [pendingRows, owedRows, paidRows] = await Promise.all([
    prisma.referralCommission.groupBy({
      by: ['currency'],
      where: { ...live, payoutId: null, payableAt: { gt: now } },
      _sum: { amountCents: true },
    }),
    prisma.referralCommission.groupBy({
      by: ['currency'],
      where: { ...live, payoutId: null, payableAt: { lte: now } },
      _sum: { amountCents: true },
    }),
    prisma.referralCommission.groupBy({
      by: ['currency'],
      where: { ...live, payoutId: { not: null } },
      _sum: { amountCents: true },
    }),
  ])
  const sum = (rows: typeof pendingRows) => new Map(rows.map((r) => [r.currency, r._sum.amountCents ?? 0]))
  const pending = sum(pendingRows)
  const owed = sum(owedRows)
  const paid = sum(paidRows)
  const currencies = new Set([...pending.keys(), ...owed.keys(), ...paid.keys()])
  return [...currencies].map((currency) => ({
    currency,
    pendingCents: pending.get(currency) ?? 0,
    owedCents: owed.get(currency) ?? 0,
    paidCents: paid.get(currency) ?? 0,
  }))
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
  bankError: boolean // true if the stored IBAN could not be decrypted
  belowThreshold: boolean // true if owed < REFERRAL_PAYOUT_MIN_CENTS
}

// Only payable commissions count: clearing window passed (payableAt ≤ now), not
// reversed, not yet in a payout.
function payableWhere(now: Date) {
  return { payoutId: null, status: { not: 'REVERSED' as const }, payableAt: { lte: now } }
}

// One pending payout per (referrer, currency) over all PAYABLE commissions.
export async function listPendingPayouts(): Promise<PendingPayout[]> {
  const now = new Date()
  const grouped = await prisma.referralCommission.groupBy({
    by: ['referrerId', 'currency'],
    where: payableWhere(now),
    _sum: { amountCents: true },
  })
  const referrers = await prisma.user.findMany({
    where: { id: { in: grouped.map((g) => g.referrerId) } },
    select: { id: true, email: true, bankHolder: true, bankBic: true, encryptedIban: true },
  })
  const byId = new Map(referrers.map((r) => [r.id, r]))
  return grouped.map((g) => {
    const u = byId.get(g.referrerId)
    // Per-row decrypt: a single corrupt/rotated IBAN must not 500 the whole list.
    let iban: string | null = null
    let bankError = false
    if (u?.encryptedIban) {
      try {
        iban = decryptSecret(u.encryptedIban)
      } catch {
        bankError = true
      }
    }
    const owedCents = g._sum.amountCents ?? 0
    return {
      referrerId: g.referrerId,
      email: u?.email ?? '',
      owedCents,
      currency: g.currency,
      holder: u?.bankHolder ?? null,
      bic: u?.bankBic ?? null,
      iban,
      bankError,
      belowThreshold: owedCents < env.REFERRAL_PAYOUT_MIN_CENTS,
    }
  })
}

// Promote PENDING commissions whose clearing window has elapsed to CONFIRMED.
// Reporting-only (payability is computed from payableAt); call from the worker.
export async function confirmDueCommissions(): Promise<number> {
  const { count } = await prisma.referralCommission.updateMany({
    where: { status: 'PENDING', payableAt: { lte: new Date() } },
    data: { status: 'CONFIRMED' },
  })
  return count
}

// Bundle a referrer's PAYABLE commissions (one currency) into a Payout.
// Race-safe: the status-guarded updateMany only claims rows still payoutId=null,
// and we assert the claimed count matches what we summed — otherwise a concurrent
// settle grabbed some rows and we roll back. Bank details are snapshot onto the
// payout so a later edit can't redirect the transfer. Enforces the min threshold.
export async function settlePayout(
  referrerId: string,
  currency: string,
): Promise<{ id: string; amountCents: number; currency: string }> {
  const now = new Date()
  return prisma.$transaction(async (tx) => {
    const payable = await tx.referralCommission.findMany({
      where: { referrerId, currency, ...payableWhere(now) },
      select: { id: true, amountCents: true },
    })
    if (payable.length === 0) throw AppError.notFound('Keine auszahlbaren Kommissionen')
    const amountCents = payable.reduce((acc, c) => acc + c.amountCents, 0)
    if (amountCents < env.REFERRAL_PAYOUT_MIN_CENTS) {
      throw AppError.badRequest('BELOW_THRESHOLD', 'Betrag unter der Auszahlungsschwelle')
    }
    const user = await tx.user.findUnique({
      where: { id: referrerId },
      select: { encryptedIban: true, ibanPreview: true, bankBic: true, bankHolder: true },
    })
    const payout = await tx.payout.create({
      data: {
        referrerId,
        amountCents,
        currency,
        status: 'CREATED',
        snapshotIban: user?.encryptedIban ?? null,
        snapshotIbanPreview: user?.ibanPreview ?? null,
        snapshotBic: user?.bankBic ?? null,
        snapshotHolder: user?.bankHolder ?? null,
      },
    })
    // Claim ONLY rows still unclaimed — closes the double-payout race.
    const { count } = await tx.referralCommission.updateMany({
      where: { id: { in: payable.map((c) => c.id) }, payoutId: null },
      data: { payoutId: payout.id, status: 'PAID' },
    })
    if (count !== payable.length) {
      // A concurrent settle claimed some of these rows; abort cleanly.
      throw AppError.conflict('SETTLE_CONFLICT', 'Auszahlung kollidierte mit einem parallelen Vorgang')
    }
    return { id: payout.id, amountCents, currency }
  })
}

// Reverse a payout that failed at the bank: unbundle its commissions back to
// CONFIRMED (payable again) and mark the payout FAILED/CANCELLED. Reversed
// commissions stay reversed. Audited by the caller.
export async function unbundlePayout(
  payoutId: string,
  outcome: 'FAILED' | 'CANCELLED',
  failureReason?: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: payoutId } })
    if (!payout) throw AppError.notFound('Payout nicht gefunden')
    if (payout.status === 'SETTLED') {
      throw AppError.badRequest('ALREADY_SETTLED', 'Ausgezahlter Payout kann nicht rückabgewickelt werden')
    }
    await tx.referralCommission.updateMany({
      where: { payoutId, status: 'PAID' },
      data: { payoutId: null, status: 'CONFIRMED' },
    })
    await tx.payout.update({
      where: { id: payoutId },
      data: { status: outcome, failureReason: failureReason ?? null },
    })
  })
}

// Mark a CREATED payout as SETTLED once the admin has sent the real transfer.
export async function markPayoutSettled(payoutId: string): Promise<void> {
  const { count } = await prisma.payout.updateMany({
    where: { id: payoutId, status: 'CREATED' },
    data: { status: 'SETTLED' },
  })
  if (count === 0) throw AppError.badRequest('INVALID_STATE', 'Payout ist nicht im Status CREATED')
}
