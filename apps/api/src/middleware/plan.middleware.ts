import type { RequestHandler } from 'express'
import type { Plan } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { AppError } from '../lib/errors'

// Karenz für Webhook-Verzögerung (Verlängerung kommt erst kurz vor/nach Ablauf an)
const PLAN_GRACE_MS = 3 * 24 * 60 * 60 * 1000

// Plan des eingeloggten Nutzers laden (für Gating in Services/Routen).
export async function getPlan(userId: string): Promise<Plan> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, planUntil: true },
  })
  if (!user) throw AppError.unauthorized()
  // PRO läuft ab, wenn das per Stripe gesetzte Periodenende (+ Karenz) überschritten
  // ist — schützt vor einem verpassten Downgrade-Webhook. Ohne planUntil
  // (Dev-Schalter / unbekannt) bleibt der Plan bestehen (kein Fehl-Downgrade).
  if (user.plan === 'PRO' && user.planUntil && user.planUntil.getTime() + PLAN_GRACE_MS < Date.now()) {
    return 'FREE'
  }
  return user.plan
}

// Route-Guard: nur Pro. Voraussetzung: requireAuth lief vorher (req.userId).
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
