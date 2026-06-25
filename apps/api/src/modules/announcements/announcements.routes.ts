import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import * as announcementsService from './announcements.service'

export const announcementsRoutes = Router()
announcementsRoutes.use(requireAuth)

announcementsRoutes.get(
  '/active',
  asyncHandler(async (_req, res) => {
    res.json({ announcements: await announcementsService.listActiveAnnouncements() })
  }),
)
