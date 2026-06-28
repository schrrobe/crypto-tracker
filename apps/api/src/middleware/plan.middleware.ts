import type { RequestHandler } from 'express'
import type { Plan } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { AppError } from '../lib/errors'

// Grace period for webhook delay (the renewal only arrives shortly before/after expiry)
export const PLAN_GRACE_MS = 3 * 24 * 60 * 60 * 1000

// A PRO subscription still counts as active until planUntil + grace has passed.
// Shared so admin stats (churn/MRR) match the gating logic in getPlan().
export function activeProCutoff(now = Date.now()): Date {
  return new Date(now - PLAN_GRACE_MS)
}

// Compute the effective entitlement from a user's billing + referral fields.
// Pure + synchronous so it can be reused wherever a user record is already loaded
// (e.g. toUserDto), keeping the entitlement rule in exactly one place.
export function effectivePlan(
  user: { plan: Plan; planUntil: Date | null; referralProUntil: Date | null },
  now = Date.now(),
): Plan {
  // Referral reward Pro-time grants entitlement independently of billing — it is
  // not Stripe-driven, so it survives cancellation and is never overwritten by a
  // webhook. Checked first so a still-valid bonus keeps PRO even after billing lapses.
  if (user.referralProUntil && user.referralProUntil.getTime() > now) return 'PRO'
  // PRO expires once the Stripe-set period end (+ grace) has passed — this guards
  // against a missed downgrade webhook. Without planUntil (dev switch / unknown)
  // the plan stays in place (no erroneous downgrade).
  if (user.plan === 'PRO' && user.planUntil && user.planUntil.getTime() + PLAN_GRACE_MS < now) {
    return 'FREE'
  }
  return user.plan
}

// Load the logged-in user's plan (for gating in services/routes).
export async function getPlan(userId: string): Promise<Plan> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planUntil: true, referralProUntil: true },
  })
  if (!user) throw AppError.unauthorized()
  return effectivePlan(user)
}

// Route guard: Pro only. Precondition: requireAuth ran before (req.userId).
export const requirePro: RequestHandler = (req, _res, next) => {
  getPlan(req.userId)
    .then((plan) => {
      if (plan !== 'PRO') {
        next(AppError.upgradeRequired())
        return
      }
      next()
    })
    .catch(next)
}
