import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { fetchMarkets } from '../../coingecko/coingecko.client'

// Market overview (top 100 by market cap) — global, no portfolio scope.
// Proxy with cache: the frontend never talks to CoinGecko directly.

const marketQuerySchema = z.object({
  currency: z.enum(['EUR', 'USD']).default('EUR'),
})

export const marketRoutes = Router()
marketRoutes.use(requireAuth)

marketRoutes.get(
  '/',
  validate(marketQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { currency } = req.query as unknown as z.infer<typeof marketQuerySchema>
    const coins = await fetchMarkets(currency.toLowerCase() as 'eur' | 'usd')
    res.json({ coins, fetchedAt: new Date().toISOString() })
  }),
)
