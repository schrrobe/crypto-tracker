import { Router } from 'express'
import type { z } from 'zod'
import { taxReportQuerySchema } from '@crypto-tracker/shared'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import * as taxService from './tax.service'

export const taxRoutes = Router()
taxRoutes.use(requireAuth)

taxRoutes.get(
  '/report',
  validate(taxReportQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const { year, country } = req.query as unknown as z.infer<typeof taxReportQuerySchema>
    res.json(await taxService.getReport(req.userId, year, country))
  }),
)
