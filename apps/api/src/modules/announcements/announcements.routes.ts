import { Router } from 'express'
import { requireAuth } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import * as announcementsService from './announcements.service'

export const announcementsRoutes = Router()

// Public, no auth: only `public` announcements. Reachable pre-login so incident /
// maintenance banners show even when users cannot authenticate. Short cache TTL
// bounds staleness (matches the ~60s client poll); no active invalidation.
announcementsRoutes.get(
  '/public',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=30')
    res.json({ announcements: await announcementsService.listPublicAnnouncements() })
  }),
)

// Everything below requires auth.
announcementsRoutes.use(requireAuth)

announcementsRoutes.get(
  '/active',
  asyncHandler(async (_req, res) => {
    res.json({ announcements: await announcementsService.listActiveAnnouncements() })
  }),
)
