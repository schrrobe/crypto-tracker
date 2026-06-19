import { Router } from 'express'
import { adminUpdatePlanSchema, adminUsersQuerySchema } from '@crypto-tracker/shared'
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

adminUsersRoutes.patch(
  '/:id/plan',
  validate(adminUpdatePlanSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    await admin.updateUserPlan(id, req.body)
    res.status(204).end()
  }),
)

adminUsersRoutes.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    await admin.deleteUser(req.userId, id)
    res.status(204).end()
  }),
)

adminUsersRoutes.post(
  '/:id/revoke-sessions',
  asyncHandler(async (req, res) => {
    const { id } = req.params
    if (!id) throw AppError.notFound()
    res.json({ revoked: await admin.revokeSessions(id) })
  }),
)
