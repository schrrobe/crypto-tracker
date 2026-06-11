import { Router } from 'express'
import type { z } from 'zod'
import {
  createTransactionSchema,
  listTransactionsQuerySchema,
  updateTransactionSchema,
} from '@crypto-tracker/shared'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { routeParam } from '../../lib/params'
import * as transactionsService from './transactions.service'

export const transactionsRoutes = Router()
transactionsRoutes.use(requireAuth)

transactionsRoutes.get(
  '/',
  validate(listTransactionsQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listTransactionsQuerySchema>
    res.json({ transactions: await transactionsService.listTransactions(req.userId, query) })
  }),
)

transactionsRoutes.post(
  '/',
  validate(createTransactionSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ transaction: await transactionsService.createTransaction(req.userId, req.body) })
  }),
)

transactionsRoutes.patch(
  '/:id',
  validate(updateTransactionSchema),
  asyncHandler(async (req, res) => {
    res.json({
      transaction: await transactionsService.updateTransaction(req.userId, routeParam(req, 'id'), req.body),
    })
  }),
)

transactionsRoutes.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await transactionsService.deleteTransaction(req.userId, routeParam(req, 'id'))
    res.status(204).end()
  }),
)
