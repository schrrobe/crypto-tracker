import { Router } from 'express'
import { createPortfolioSchema, updatePortfolioSchema } from '@crypto-tracker/shared'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { routeParam } from '../../lib/params'
import * as portfoliosService from './portfolios.service'

export const portfoliosRoutes = Router()
portfoliosRoutes.use(requireAuth)

portfoliosRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ portfolios: await portfoliosService.listPortfolios(req.userId) })
  }),
)

portfoliosRoutes.post(
  '/',
  validate(createPortfolioSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ portfolio: await portfoliosService.createPortfolio(req.userId, req.body.label) })
  }),
)

portfoliosRoutes.patch(
  '/:id',
  validate(updatePortfolioSchema),
  asyncHandler(async (req, res) => {
    res.json({
      portfolio: await portfoliosService.renamePortfolio(req.userId, routeParam(req, 'id'), req.body.label),
    })
  }),
)

portfoliosRoutes.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await portfoliosService.deletePortfolio(req.userId, routeParam(req, 'id'))
    res.status(204).end()
  }),
)
