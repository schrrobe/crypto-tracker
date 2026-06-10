import { Router } from 'express'
import { createManualSourceSchema, updateSourceSchema, upsertHoldingSchema, updateHoldingSchema } from '@crypto-tracker/shared'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { routeParam } from '../../lib/params'
import * as sourcesService from './sources.service'
import * as holdingsService from '../holdings/holdings.service'

export const sourcesRoutes = Router()
sourcesRoutes.use(requireAuth)

sourcesRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ sources: await sourcesService.listSources(req.userId) })
  }),
)

// In Meilenstein 3 wird das zu einer discriminated union (manual | exchange | wallet)
sourcesRoutes.post(
  '/',
  validate(createManualSourceSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ source: await sourcesService.createManualSource(req.userId, req.body.label) })
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
