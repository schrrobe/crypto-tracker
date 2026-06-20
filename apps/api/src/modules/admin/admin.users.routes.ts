import { Router } from 'express'
import { adminSetAdminSchema, adminUpdatePlanSchema, adminUsersQuerySchema } from '@crypto-tracker/shared'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { AppError } from '../../lib/errors'
import * as admin from './admin.service'

export const adminUsersRoutes = Router()

adminUsersRoutes.get(
  '/',
  validate(adminUsersQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const q = adminUsersQuerySchema.parse(req.query)
    res.json(await admin.listUsers(q))
  }),
)

adminUsersRoutes.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    res.json(await admin.getUserDetail(id))
  }),
)

adminUsersRoutes.get(
  '/:id/sources',
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    res.json({ sources: await admin.adminListUserSources(id) })
  }),
)

adminUsersRoutes.patch(
  '/:id/plan',
  validate(adminUpdatePlanSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    await admin.updateUserPlan(req.adminUser, id, req.body)
    res.status(204).end()
  }),
)

adminUsersRoutes.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    await admin.deleteUser(req.adminUser, id)
    res.status(204).end()
  }),
)

adminUsersRoutes.post(
  '/:id/suspend',
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    await admin.setSuspended(req.adminUser, id, true)
    res.status(204).end()
  }),
)

adminUsersRoutes.post(
  '/:id/unsuspend',
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    await admin.setSuspended(req.adminUser, id, false)
    res.status(204).end()
  }),
)

adminUsersRoutes.patch(
  '/:id/admin',
  validate(adminSetAdminSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    await admin.setAdmin(req.adminUser, id, req.body.isAdmin)
    res.status(204).end()
  }),
)

adminUsersRoutes.post(
  '/:id/revoke-sessions',
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    res.json({ revoked: await admin.revokeSessions(req.adminUser, id) })
  }),
)
