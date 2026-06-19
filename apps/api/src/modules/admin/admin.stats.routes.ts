import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import * as admin from './admin.service'

export const adminStatsRoutes = Router()

const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) })

adminStatsRoutes.get('/overview', asyncHandler(async (_req, res) => res.json(await admin.getOverview())))

adminStatsRoutes.get(
  '/growth',
  validate(daysQuery, 'query'),
  asyncHandler(async (req, res) => res.json({ points: await admin.getGrowth(Number(req.query.days ?? 30)) })),
)

adminStatsRoutes.get(
  '/sync-health',
  validate(z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }), 'query'),
  asyncHandler(async (req, res) => res.json(await admin.getSyncHealth(Number(req.query.days ?? 7)))),
)

adminStatsRoutes.get('/sources', asyncHandler(async (_req, res) => res.json(await admin.getSourcesStats())))
adminStatsRoutes.get('/imports', asyncHandler(async (_req, res) => res.json(await admin.getImportsStats())))
adminStatsRoutes.get('/assets', asyncHandler(async (_req, res) => res.json(await admin.getAssetsStats())))

adminStatsRoutes.get(
  '/transactions',
  validate(daysQuery, 'query'),
  asyncHandler(async (req, res) => res.json(await admin.getTransactionsStats(Number(req.query.days ?? 30)))),
)

adminStatsRoutes.get('/price-cache', asyncHandler(async (_req, res) => res.json(await admin.getPriceCacheStats())))
