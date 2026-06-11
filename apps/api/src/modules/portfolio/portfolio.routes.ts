import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
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

const historyQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d']).default('24h'),
  currency: z.enum(['EUR', 'USD']).default('EUR'),
})

portfolioRoutes.get(
  '/history',
  validate(historyQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { range, currency } = req.query as unknown as z.infer<typeof historyQuerySchema>
    res.json(await portfolioService.getHistory(req.userId, range, currency))
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
