import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import * as referralService from './referral.service'

export const referralRoutes = Router()
referralRoutes.use(requireAuth)

referralRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await referralService.getReferralOverview(req.userId))
  }),
)
