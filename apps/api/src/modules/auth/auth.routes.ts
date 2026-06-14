import { Router, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@crypto-tracker/shared'
import { z } from 'zod'
import { validate } from '../../middleware/validate.middleware'
import { requireAuth } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { AppError } from '../../lib/errors'
import { env } from '../../config/env'
import * as authService from './auth.service'
import {
  clearRefreshCookie,
  isNativeClient,
  readRefreshToken,
  setRefreshCookie,
} from './refresh-cookie'

export const authRoutes = Router()

// Antwort je Client: nativ bekommt den Refresh-Token im Body (Secure Storage),
// Web bekommt ein httpOnly-Cookie und den Token NICHT im Body (für JS unlesbar).
function sendAuth(req: Request, res: Response, result: authService.AuthResult, status = 200): void {
  if (isNativeClient(req)) {
    res.status(status).json(result)
    return
  }
  setRefreshCookie(res, result.refreshToken)
  const { refreshToken: _omit, ...body } = result
  void _omit
  res.status(status).json(body)
}

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
    sendAuth(req, res, await authService.register(email, password), 201)
  }),
)

authRoutes.post(
  '/login',
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body
    sendAuth(req, res, await authService.login(email, password))
  }),
)

authRoutes.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = readRefreshToken(req)
    if (!token) throw AppError.unauthorized('Sitzung abgelaufen, bitte neu anmelden')
    sendAuth(req, res, await authService.refresh(token))
  }),
)

authRoutes.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = readRefreshToken(req)
    if (token) await authService.logout(token)
    if (!isNativeClient(req)) clearRefreshCookie(res)
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

const updateMeSchema = z.object({
  baseCurrency: z.enum(['EUR', 'USD']).optional(),
  autoSyncEnabled: z.boolean().optional(),
  // nur im local-Modus wirksam (Dev-Schalter) — Service ignoriert es sonst
  plan: z.enum(['FREE', 'PRO']).optional(),
})

authRoutes.patch(
  '/me',
  requireAuth,
  validate(updateMeSchema),
  asyncHandler(async (req, res) => {
    res.json({ user: await authService.updateMe(req.userId, req.body) })
  }),
)

// Konto-Löschung (Apple/Google verlangen In-App-Löschung). Entfernt alle Daten
// des Nutzers; auf Web zusätzlich das Refresh-Cookie löschen.
authRoutes.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    await authService.deleteAccount(req.userId)
    if (!isNativeClient(req)) clearRefreshCookie(res)
    res.status(204).end()
  }),
)
