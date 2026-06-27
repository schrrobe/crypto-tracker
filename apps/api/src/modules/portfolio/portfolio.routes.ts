import { Router } from 'express'
import { z } from 'zod'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { historyRangesFor, portfolioScopeQuerySchema } from '@crypto-tracker/shared'
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

// Unrealized profit/loss — Pro feature
portfolioRoutes.get(
  '/pnl',
  requirePro,
  validate(portfolioScopeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { portfolioId } = req.query as { portfolioId?: string }
    res.json(await pnlService.getPnl(req.userId, portfolioId))
  }),
)

// Open futures/perpetual positions (free, no Pro gate)
portfolioRoutes.get(
  '/futures',
  validate(portfolioScopeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { portfolioId } = req.query as { portfolioId?: string }
    res.json({ positions: await holdingsService.listFuturesPositions(req.userId, portfolioId) })
  }),
)

const historyQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d', '1y']).default('24h'),
  currency: z.enum(['EUR', 'USD']).default('EUR'),
  portfolioId: z.string().uuid().optional(),
})

// Per-user limiter: /history fans out to up to 10 live CoinGecko market_chart
// calls on a cold cache against a single shared demo key. Without this a logged-in
// user cycling range/currency could exhaust the upstream quota for everyone.
// Keyed by userId (requireAuth runs first), so one noisy account can't starve others.
const historyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Keyed by userId (requireAuth guarantees it). IP fallback is dead-code defense;
  // routed through ipKeyGenerator for correct IPv6 subnet normalization.
  keyGenerator: (req) => req.userId ?? ipKeyGenerator(req.ip ?? 'anonymous'),
  handler: (_req, res) => {
    res
      .status(429)
      .json({ error: { code: 'RATE_LIMITED', message: 'Zu viele Anfragen, bitte kurz warten.' } })
  },
})

portfolioRoutes.get(
  '/history',
  historyLimiter,
  validate(historyQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { range, currency, portfolioId } = req.query as unknown as z.infer<typeof historyQuerySchema>
    // allowed ranges centrally from the entitlements (1y is Pro-exclusive)
    if (!historyRangesFor(await getPlan(req.userId)).includes(range)) {
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
  validate(portfolioScopeQuerySchema, 'body'),
  asyncHandler(async (req, res) => {
    const { portfolioId } = req.body as { portfolioId?: string }
    const result = await portfolioService.refreshUserPrices(req.userId, portfolioId)
    res.json(result)
  }),
)
