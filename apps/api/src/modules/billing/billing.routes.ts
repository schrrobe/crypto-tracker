import { Router, type RequestHandler } from 'express'
import { requireAuth } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import * as billingService from './billing.service'

export const billingRoutes = Router()
billingRoutes.use(requireAuth)

// Billing config (is checkout available, price label) — drives the paywall CTA
billingRoutes.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json(billingService.billingConfig())
  }),
)

// Checkout session for the Pro subscription → URL to the Stripe Checkout
billingRoutes.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    res.json({ url: await billingService.createCheckoutSession(req.userId) })
  }),
)

// Customer Portal (manage/cancel the subscription)
billingRoutes.post(
  '/portal',
  asyncHandler(async (req, res) => {
    res.json({ url: await billingService.createPortalSession(req.userId) })
  }),
)

// Stripe webhook — NO requireAuth, RAW body (mounted in app.ts before express.json).
export const billingWebhookHandler: RequestHandler = (req, res, next) => {
  billingService
    .handleWebhookEvent(req.body as Buffer, req.get('stripe-signature'))
    .then(() => res.status(204).end())
    .catch(next)
}
