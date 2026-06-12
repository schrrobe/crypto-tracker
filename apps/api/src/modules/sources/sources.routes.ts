import { Router } from 'express'
import { createSourceSchema, updateSourceSchema, upsertHoldingSchema, updateHoldingSchema } from '@crypto-tracker/shared'
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
  asyncHandler(async (req, res) => {
    res.json({ sources: await sourcesService.listSources(req.userId) })
  }),
)

sourcesRoutes.post(
  '/',
  validate(createSourceSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ source: await sourcesService.createSource(req.userId, req.body) })
  }),
)

// Sync: Provider-Fehler landen im Run (status ERROR), nicht als HTTP-Fehler.
// Queue-Modus (REDIS_URL gesetzt): 202 + RUNNING-Run, Worker führt aus, Frontend pollt.
sourcesRoutes.post(
  '/sync-all',
  asyncHandler(async (req, res) => {
    const { results, queued } = await syncService.syncAllSources(req.userId)
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

// Manuelle Bestände innerhalb einer Quelle
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
