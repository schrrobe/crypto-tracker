import { Router } from 'express'
import { bankDetailsSchema } from '@crypto-tracker/shared'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
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

referralRoutes.get(
  '/bank',
  asyncHandler(async (req, res) => {
    res.json(await referralService.getBankDetails(req.userId))
  }),
)

referralRoutes.put(
  '/bank',
  validate(bankDetailsSchema),
  asyncHandler(async (req, res) => {
    res.json(await referralService.saveBankDetails(req.userId, req.body))
  }),
)
