import { Router } from 'express'
import { asyncHandler } from '../../lib/asyncHandler'
import { AppError } from '../../lib/errors'
import * as admin from './admin.service'

export const adminSyncRoutes = Router()

// Admin-triggered manual sync of any source. 202 if queued, 200 if inline.
adminSyncRoutes.post(
  '/:sourceId/sync',
  asyncHandler(async (req, res) => {
    const { sourceId } = req.params
    if (!sourceId) throw AppError.notFound()
    const result = await admin.adminTriggerSync(req.adminUser, sourceId)
    res.status(result.queued ? 202 : 200).json(result)
  }),
)
