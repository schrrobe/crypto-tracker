import { randomBytes } from 'node:crypto'
import { env } from '../../config/env'
import { prisma } from '../../lib/prisma'
import { effectivePlan } from '../../middleware/plan.middleware'
import type { ReferralDto } from '@crypto-tracker/shared'

// Unambiguous alphabet (no 0/O/1/I) for human-shareable codes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LEN = 8

// Reward economics: both sides earn free Pro-time, never cash.
//  - Invitee gets REWARD_DAYS the moment they register with a valid code (drives code entry).
//  - Referrer gets REWARD_DAYS once, when the invitee first converts to a paid Pro plan
//    (real reward gated behind a real payment → fraud-resistant, near-zero marginal cost).
export const REWARD_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

type RewardKind = 'SIGNUP' | 'CONVERSION'

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

function isUniqueViolation(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002')
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  const head = local.slice(0, 1)
  return `${head}***@${domain}`
}

// Atomically record a reward (idempotent via idempotencyKey) AND extend the
// recipient's referralProUntil. The unique key makes a webhook retry or a double
// signup a no-op: if the ledger row already exists, no second grant happens.
//
//   referralProUntil:  now ──┐
//                            ├─ base = max(now, current) ──► base + REWARD_DAYS
//   current bonus end ───────┘   (stacks on a still-active bonus, never shortens it)
async function grantReward(input: {
  userId: string
  kind: RewardKind
  idempotencyKey: string
  referredUserId: string | null
}): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.referralReward.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
          referredUserId: input.referredUserId,
          grantedDays: REWARD_DAYS,
        },
      })
      const u = await tx.user.findUnique({ where: { id: input.userId }, select: { referralProUntil: true } })
      const now = Date.now()
      const base = u?.referralProUntil && u.referralProUntil.getTime() > now ? u.referralProUntil.getTime() : now
      await tx.user.update({
        where: { id: input.userId },
        data: { referralProUntil: new Date(base + REWARD_DAYS * DAY_MS) },
      })
    })
  } catch (e) {
    if (isUniqueViolation(e)) return // already granted — idempotent no-op
    throw e
  }
}

// Invitee reward: granted once when a user registers with a valid code.
export async function grantSignupReward(inviteeId: string): Promise<void> {
  await grantReward({
    userId: inviteeId,
    kind: 'SIGNUP',
    idempotencyKey: `signup:${inviteeId}`,
    referredUserId: null,
  })
}

// Referrer reward: granted once when an invited user first converts to paid Pro.
// Self-referral guard (defense in depth) — the referrer must not be the referred user.
export async function grantConversionReward(referredUserId: string, referrerId: string): Promise<void> {
  if (referrerId === referredUserId) return
  await grantReward({
    userId: referrerId,
    kind: 'CONVERSION',
    idempotencyKey: `conversion:${referredUserId}`,
    referredUserId,
  })
}

// Refund / chargeback: void the conversion reward for audit + accurate metrics.
// Already-granted Pro-days are intentionally NOT clawed back — the marginal cost of
// granted Pro-time is near zero (unlike cash), so retroactively stripping consumed
// days is not worth the complexity. Returns how many rewards were voided.
export async function voidConversionReward(referredUserId: string): Promise<number> {
  const res = await prisma.referralReward.updateMany({
    where: { kind: 'CONVERSION', referredUserId, voidedAt: null },
    data: { voidedAt: new Date() },
  })
  return res.count
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
    select: { email: true, plan: true, planUntil: true, referralProUntil: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })

  // Pro-days earned + conversions, from the non-voided reward ledger.
  const rewards = await prisma.referralReward.findMany({
    where: { userId, voidedAt: null },
    select: { kind: true, grantedDays: true },
  })
  const earnedProDays = rewards.reduce((acc, r) => acc + r.grantedDays, 0)
  const proConversions = rewards.filter((r) => r.kind === 'CONVERSION').length

  return {
    code: user.referralCode!,
    link: `${env.APP_PUBLIC_URL}/register?ref=${user.referralCode}`,
    invitedCount: invited.length,
    proConversions,
    earnedProDays,
    rewardDays: REWARD_DAYS,
    invited: invited.map((i) => ({
      emailMasked: maskEmail(i.email),
      joinedAt: i.createdAt.toISOString(),
      isPro: effectivePlan(i) === 'PRO',
    })),
  }
}
