import { Router } from 'express'
import { movementsQuerySchema, type MovementsQuery } from '@crypto-tracker/shared'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import * as movementsService from './movements.service'

export const movementsRoutes = Router()
movementsRoutes.use(requireAuth)

// Statement lines (netted per day/source/asset); window depends on the plan
movementsRoutes.get(
  '/',
  validate(movementsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await movementsService.listMovementGroups(req.userId, req.query as unknown as MovementsQuery))
  }),
)
