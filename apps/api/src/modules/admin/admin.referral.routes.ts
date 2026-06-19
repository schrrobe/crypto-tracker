import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { AppError } from '../../lib/errors'
import { listPendingPayouts, settlePayout } from '../referral/referral.service'
import * as admin from './admin.service'

export const adminReferralRoutes = Router()

adminReferralRoutes.get(
  '/payouts',
  asyncHandler(async (_req, res) => res.json({ payouts: await listPendingPayouts() })),
)

adminReferralRoutes.get(
  '/payouts/history',
  asyncHandler(async (_req, res) => res.json({ payouts: await admin.listPayoutHistory() })),
)

const settleSchema = z.object({ currency: z.string().min(1) })

adminReferralRoutes.post(
  '/payouts/:referrerId/settle',
  validate(settleSchema),
  asyncHandler(async (req, res) => {
    const { referrerId } = req.params
    if (!referrerId) throw AppError.notFound()
    res.json(await settlePayout(referrerId, req.body.currency))
  }),
)

adminReferralRoutes.get(
  '/commissions',
  validate(z.object({ referrerId: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    res.json({ commissions: await admin.listCommissions(req.query.referrerId as string | undefined) })
  }),
)

adminReferralRoutes.post(
  '/commissions/:id/void',
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    await admin.voidCommission(id)
    res.status(204).end()
  }),
)
