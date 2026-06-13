import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { fetchMarkets } from '../../coingecko/coingecko.client'

// Marktüberblick (Top 100 nach Market Cap) — global, kein Portfolio-Scope.
// Proxy mit Cache: das Frontend spricht nie direkt mit CoinGecko.

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
