import type { RequestHandler } from 'express'
import type { Plan } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { AppError } from '../lib/errors'

// Plan des eingeloggten Nutzers laden (für Gating in Services/Routen).
export async function getPlan(userId: string): Promise<Plan> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
  if (!user) throw AppError.unauthorized()
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
