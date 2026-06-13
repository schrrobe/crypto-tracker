import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import {
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from '@crypto-tracker/shared'
import { z } from 'zod'
import { validate } from '../../middleware/validate.middleware'
import { requireAuth } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { env } from '../../config/env'
import * as authService from './auth.service'

export const authRoutes = Router()

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.APP_ENV === 'local' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Zu viele Versuche, bitte später erneut' } },
})
authRoutes.use(authLimiter)

authRoutes.post(
  '/register',
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body
    res.status(201).json(await authService.register(email, password))
  }),
)

authRoutes.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body
    res.json(await authService.login(email, password))
  }),
)

authRoutes.post(
  '/refresh',
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    res.json(await authService.refresh(req.body.refreshToken))
  }),
)

authRoutes.post(
  '/logout',
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    await authService.logout(req.body.refreshToken)
    res.status(204).end()
  }),
)

authRoutes.post(
  '/forgot-password',
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    await authService.forgotPassword(req.body.email)
    // Immer 204 — keine Auskunft, ob die Adresse registriert ist
    res.status(204).end()
  }),
)

authRoutes.post(
  '/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    await authService.resetPassword(req.body.token, req.body.password)
    res.status(204).end()
  }),
)

authRoutes.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: await authService.getMe(req.userId) })
  }),
)

const updateMeSchema = z.object({ baseCurrency: z.enum(['EUR', 'USD']).optional() })

authRoutes.patch(
  '/me',
  requireAuth,
  validate(updateMeSchema),
  asyncHandler(async (req, res) => {
    res.json({ user: await authService.updateMe(req.userId, req.body) })
  }),
)
