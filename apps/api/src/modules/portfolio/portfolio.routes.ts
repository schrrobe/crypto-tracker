import { Router } from 'express'
import { z } from 'zod'
import { portfolioScopeQuerySchema } from '@crypto-tracker/shared'
import { requireAuth } from '../../middleware/auth.middleware'
import { getPlan, requirePro } from '../../middleware/plan.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { AppError } from '../../lib/errors'
import * as portfolioService from './portfolio.service'
import * as pnlService from './pnl.service'
import * as holdingsService from '../holdings/holdings.service'

export const portfolioRoutes = Router()
portfolioRoutes.use(requireAuth)

portfolioRoutes.get(
  '/summary',
  validate(portfolioScopeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { portfolioId } = req.query as { portfolioId?: string }
    res.json(await portfolioService.getSummary(req.userId, portfolioId))
  }),
)

// Unrealisierter Gewinn/Verlust — Pro-Funktion
portfolioRoutes.get(
  '/pnl',
  requirePro,
  validate(portfolioScopeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { portfolioId } = req.query as { portfolioId?: string }
    res.json(await pnlService.getPnl(req.userId, portfolioId))
  }),
)

const historyQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d', '1y']).default('24h'),
  currency: z.enum(['EUR', 'USD']).default('EUR'),
  portfolioId: z.string().uuid().optional(),
})

portfolioRoutes.get(
  '/history',
  validate(historyQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { range, currency, portfolioId } = req.query as unknown as z.infer<typeof historyQuerySchema>
    // 1-Jahres-Verlauf ist Pro-exklusiv
    if (range === '1y' && (await getPlan(req.userId)) !== 'PRO') {
      throw AppError.upgradeRequired()
    }
    res.json(await portfolioService.getHistory(req.userId, range, currency, portfolioId))
  }),
)

export const holdingsRoutes = Router()
holdingsRoutes.use(requireAuth)

holdingsRoutes.get(
  '/',
  validate(portfolioScopeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { portfolioId } = req.query as { portfolioId?: string }
    res.json({ holdings: await holdingsService.listHoldings(req.userId, portfolioId) })
  }),
)

export const pricesRoutes = Router()
pricesRoutes.use(requireAuth)

pricesRoutes.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const portfolioId = typeof req.body?.portfolioId === 'string' ? req.body.portfolioId : undefined
    const result = await portfolioService.refreshUserPrices(req.userId, portfolioId)
    res.json(result)
  }),
)
