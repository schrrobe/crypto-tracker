import { Router } from 'express'
import { submitSurveyResponseSchema } from '@crypto-tracker/shared'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { routeParam } from '../../lib/params'
import * as surveysService from './surveys.service'

export const surveysRoutes = Router()
surveysRoutes.use(requireAuth)

surveysRoutes.get(
  '/pending',
  asyncHandler(async (req, res) => {
    res.json({ surveys: await surveysService.listPendingSurveys(req.userId) })
  }),
)

surveysRoutes.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ survey: await surveysService.getPublishedSurvey(req.userId, routeParam(req, 'id')) })
  }),
)

surveysRoutes.post(
  '/:id/responses',
  validate(submitSurveyResponseSchema),
  asyncHandler(async (req, res) => {
    await surveysService.submitResponse(req.userId, routeParam(req, 'id'), req.body)
    res.status(201).end()
  }),
)
