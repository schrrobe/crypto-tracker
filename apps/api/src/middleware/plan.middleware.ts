import type { RequestHandler } from 'express'
import type { Plan } from '@prisma/client'
import type { ProFeature } from '@crypto-tracker/shared'
import { prisma } from '../lib/prisma'
import { AppError } from '../lib/errors'

// Grace period for webhook delay (the renewal only arrives shortly before/after expiry)
export const PLAN_GRACE_MS = 3 * 24 * 60 * 60 * 1000

// A PRO subscription still counts as active until planUntil + grace has passed.
// Shared so admin stats (churn/MRR) match the gating logic in getPlan().
export function activeProCutoff(now = Date.now()): Date {
  return new Date(now - PLAN_GRACE_MS)
}

// Load the logged-in user's plan (for gating in services/routes).
export async function getPlan(userId: string): Promise<Plan> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planUntil: true },
  })
  if (!user) throw AppError.unauthorized()
  // PRO expires once the Stripe-set period end (+ grace) has passed — this guards
  // against a missed downgrade webhook. Without planUntil (dev switch / unknown)
  // the plan stays in place (no erroneous downgrade).
  if (user.plan === 'PRO' && user.planUntil && user.planUntil.getTime() + PLAN_GRACE_MS < Date.now()) {
    return 'FREE'
  }
  return user.plan
}

// Route guard factory: Pro only. The feature key rides along on the 402 details
// so the client can show a contextual paywall. Precondition: requireAuth ran (req.userId).
export function requirePro(feature: ProFeature): RequestHandler {
  return (req, _res, next) => {
    getPlan(req.userId)
      .then((plan) => {
        if (plan !== 'PRO') {
          next(AppError.upgradeRequired(undefined, { feature }))
          return
        }
        next()
      })
      .catch(next)
  }
}
