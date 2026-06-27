import { Router } from 'express'
import {
  createSourceSchema,
  portfolioScopeQuerySchema,
  updateSourceSchema,
  upsertHoldingSchema,
  updateHoldingSchema,
} from '@crypto-tracker/shared'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { routeParam } from '../../lib/params'
import * as sourcesService from './sources.service'
import * as holdingsService from '../holdings/holdings.service'
import * as syncService from '../sync/sync.service'

export const sourcesRoutes = Router()
sourcesRoutes.use(requireAuth)

sourcesRoutes.get(
  '/',
  validate(portfolioScopeQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { portfolioId } = req.query as { portfolioId?: string }
    res.json({ sources: await sourcesService.listSources(req.userId, portfolioId) })
  }),
)

sourcesRoutes.post(
  '/',
  validate(createSourceSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ source: await sourcesService.createSource(req.userId, req.body) })
  }),
)

// Sync: provider errors land in the run (status ERROR), not as an HTTP error.
// Queue mode (REDIS_URL set): 202 + RUNNING run, the worker executes it, the frontend polls.
sourcesRoutes.post(
  '/sync-all',
  validate(portfolioScopeQuerySchema, 'body'),
  asyncHandler(async (req, res) => {
    const { portfolioId } = req.body as { portfolioId?: string }
    const { results, queued } = await syncService.syncAllSources(req.userId, portfolioId)
    res.status(queued ? 202 : 200).json({ results })
  }),
)

sourcesRoutes.post(
  '/:id/sync',
  asyncHandler(async (req, res) => {
    const { run, queued } = await syncService.requestSync(req.userId, routeParam(req, 'id'))
    res.status(queued ? 202 : 200).json({ run })
  }),
)

sourcesRoutes.get(
  '/:id/sync-runs',
  asyncHandler(async (req, res) => {
    res.json({ runs: await syncService.listSyncRuns(req.userId, routeParam(req, 'id')) })
  }),
)

sourcesRoutes.patch(
  '/:id',
  validate(updateSourceSchema),
  asyncHandler(async (req, res) => {
    res.json({ source: await sourcesService.updateSource(req.userId, routeParam(req, 'id'), req.body.label) })
  }),
)

sourcesRoutes.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await sourcesService.deleteSource(req.userId, routeParam(req, 'id'))
    res.status(204).end()
  }),
)

// Manual holdings within a source
sourcesRoutes.post(
  '/:id/holdings',
  validate(upsertHoldingSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ holding: await holdingsService.createHolding(req.userId, routeParam(req, 'id'), req.body) })
  }),
)

sourcesRoutes.patch(
  '/:id/holdings/:holdingId',
  validate(updateHoldingSchema),
  asyncHandler(async (req, res) => {
    res.json({
      holding: await holdingsService.updateHolding(
        req.userId,
        routeParam(req, 'id'),
        routeParam(req, 'holdingId'),
        req.body.quantity,
      ),
    })
  }),
)

sourcesRoutes.delete(
  '/:id/holdings/:holdingId',
  asyncHandler(async (req, res) => {
    await holdingsService.deleteHolding(req.userId, routeParam(req, 'id'), routeParam(req, 'holdingId'))
    res.status(204).end()
  }),
)
