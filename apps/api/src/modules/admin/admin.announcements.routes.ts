import { Router } from 'express'
import { createAnnouncementSchema, updateAnnouncementSchema } from '@crypto-tracker/shared'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { routeParam } from '../../lib/params'
import * as announcements from './admin.announcements.service'

export const adminAnnouncementsRoutes = Router()

adminAnnouncementsRoutes.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await announcements.listAnnouncements())
  }),
)

adminAnnouncementsRoutes.post(
  '/',
  validate(createAnnouncementSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ announcement: await announcements.createAnnouncement(req.adminUser, req.body) })
  }),
)

adminAnnouncementsRoutes.patch(
  '/:id',
  validate(updateAnnouncementSchema),
  asyncHandler(async (req, res) => {
    res.json({ announcement: await announcements.updateAnnouncement(req.adminUser, routeParam(req, 'id'), req.body) })
  }),
)

adminAnnouncementsRoutes.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await announcements.deleteAnnouncement(req.adminUser, routeParam(req, 'id'))
    res.status(204).end()
  }),
)
