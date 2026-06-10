import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import * as portfolioService from './portfolio.service'
import * as holdingsService from '../holdings/holdings.service'

export const portfolioRoutes = Router()
portfolioRoutes.use(requireAuth)

portfolioRoutes.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json(await portfolioService.getSummary(req.userId))
  }),
)

export const holdingsRoutes = Router()
holdingsRoutes.use(requireAuth)

holdingsRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ holdings: await holdingsService.listHoldings(req.userId) })
  }),
)

export const pricesRoutes = Router()
pricesRoutes.use(requireAuth)

pricesRoutes.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const result = await portfolioService.refreshUserPrices(req.userId)
    res.json(result)
  }),
)
