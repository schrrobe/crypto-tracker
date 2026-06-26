import { Router } from 'express'
import { z } from 'zod'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { fetchMarkets } from '../../coingecko/coingecko.client'

// Market overview (top 100 by market cap) — global, no portfolio scope.
// Proxy with cache: the frontend never talks to CoinGecko directly.

const marketQuerySchema = z.object({
  currency: z.enum(['EUR', 'USD']).default('EUR'),
})

// Per-user limiter: on an expiring 60-s cache this fans out to CoinGecko against
// a single shared demo key. The single-flight in the client collapses concurrent
// misses, but this caps how fast one account can force cold fetches. Keyed by
// userId (requireAuth runs first); IP fallback is dead-code defense.
const marketLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.userId ?? ipKeyGenerator(req.ip ?? 'anonymous'),
  handler: (_req, res) => {
    res
      .status(429)
      .json({ error: { code: 'RATE_LIMITED', message: 'Zu viele Anfragen, bitte kurz warten.' } })
  },
})

export const marketRoutes = Router()
marketRoutes.use(requireAuth)

marketRoutes.get(
  '/',
  marketLimiter,
  validate(marketQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { currency } = req.query as unknown as z.infer<typeof marketQuerySchema>
    const coins = await fetchMarkets(currency.toLowerCase() as 'eur' | 'usd')
    res.json({ coins, fetchedAt: new Date().toISOString() })
  }),
)
