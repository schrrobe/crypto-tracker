import { Router } from 'express'
import {
  createSurveySchema,
  surveyAudienceQuerySchema,
  surveyFreeTextQuerySchema,
  updateSurveySchema,
  type SurveyAudienceQuery,
  type SurveyFreeTextQuery,
} from '@crypto-tracker/shared'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { routeParam } from '../../lib/params'
import * as surveys from './admin.surveys.service'

export const adminSurveysRoutes = Router()

adminSurveysRoutes.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await surveys.listSurveys())
  }),
)

adminSurveysRoutes.post(
  '/',
  validate(createSurveySchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await surveys.createSurvey(req.adminUser, req.body))
  }),
)

// Registered before any "/:id" route so the literal path is not captured as an id.
adminSurveysRoutes.get(
  '/audience',
  validate(surveyAudienceQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await surveys.countAudience(req.query as unknown as SurveyAudienceQuery))
  }),
)

// Full editable survey (edit-draft mode). After /audience so the literal wins.
adminSurveysRoutes.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await surveys.getSurveyDetail(routeParam(req, 'id')))
  }),
)

adminSurveysRoutes.patch(
  '/:id',
  validate(updateSurveySchema),
  asyncHandler(async (req, res) => {
    await surveys.updateSurvey(req.adminUser, routeParam(req, 'id'), req.body)
    res.status(204).end()
  }),
)

adminSurveysRoutes.post(
  '/:id/publish',
  asyncHandler(async (req, res) => {
    await surveys.publishSurvey(req.adminUser, routeParam(req, 'id'))
    res.status(204).end()
  }),
)

adminSurveysRoutes.post(
  '/:id/close',
  asyncHandler(async (req, res) => {
    await surveys.closeSurvey(req.adminUser, routeParam(req, 'id'))
    res.status(204).end()
  }),
)

adminSurveysRoutes.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await surveys.deleteSurvey(req.adminUser, routeParam(req, 'id'))
    res.status(204).end()
  }),
)

adminSurveysRoutes.get(
  '/:id/results',
  asyncHandler(async (req, res) => {
    res.json(await surveys.getResults(routeParam(req, 'id')))
  }),
)

adminSurveysRoutes.get(
  '/:id/free-text',
  validate(surveyFreeTextQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    // validate() already replaced req.query with the parsed, coerced value.
    res.json(await surveys.listFreeTextAnswers(routeParam(req, 'id'), req.query as unknown as SurveyFreeTextQuery))
  }),
)

adminSurveysRoutes.get(
  '/:id/free-text/export.csv',
  asyncHandler(async (req, res) => {
    const questionId = String(req.query.questionId ?? '')
    const csv = await surveys.freeTextCsv(req.adminUser, routeParam(req, 'id'), questionId)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="survey-free-text.csv"')
    res.send(csv)
  }),
)

adminSurveysRoutes.post(
  '/:id/remind',
  asyncHandler(async (req, res) => {
    res.json(await surveys.remindNonResponders(req.adminUser, routeParam(req, 'id')))
  }),
)
