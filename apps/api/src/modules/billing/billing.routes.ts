import { Router, type RequestHandler } from 'express'
import { requireAuth } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import * as billingService from './billing.service'

export const billingRoutes = Router()
billingRoutes.use(requireAuth)

// Checkout-Session fürs Pro-Abo → URL zum Stripe-Checkout
billingRoutes.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    res.json({ url: await billingService.createCheckoutSession(req.userId) })
  }),
)

// Customer Portal (Abo verwalten/kündigen)
billingRoutes.post(
  '/portal',
  asyncHandler(async (req, res) => {
    res.json({ url: await billingService.createPortalSession(req.userId) })
  }),
)

// Stripe-Webhook — KEIN requireAuth, RAW Body (in app.ts vor express.json gemountet).
export const billingWebhookHandler: RequestHandler = (req, res, next) => {
  billingService
    .handleWebhookEvent(req.body as Buffer, req.get('stripe-signature'))
    .then(() => res.status(204).end())
    .catch(next)
}
