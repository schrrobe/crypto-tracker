import { Router } from 'express'
import { adminAuditQuerySchema } from '@crypto-tracker/shared'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { listAudit } from './audit.service'

export const adminAuditRoutes = Router()

adminAuditRoutes.get(
  '/',
  validate(adminAuditQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await listAudit(adminAuditQuerySchema.parse(req.query)))
  }),
)
