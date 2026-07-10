import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import * as admin from './admin.service'

export const adminReferralRoutes = Router()

// Reward-based referral program: no cash, no payouts. Admin gets read-only
// visibility into the reward ledger (free Pro-day grants).
adminReferralRoutes.get(
  '/rewards',
  asyncHandler(async (_req, res) => res.json({ rewards: await admin.listReferralRewards() })),
)
