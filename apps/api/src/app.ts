import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { env } from './config/env'
import { errorMiddleware } from './middleware/error.middleware'
import { authRoutes } from './modules/auth/auth.routes'
import { sourcesRoutes } from './modules/sources/sources.routes'
import { holdingsRoutes, portfolioRoutes, pricesRoutes } from './modules/portfolio/portfolio.routes'
import { assetsRoutes } from './modules/assets/assets.routes'
import { importsRoutes } from './modules/imports/imports.routes'
import { transactionsRoutes } from './modules/transactions/transactions.routes'
import { taxRoutes } from './modules/tax/tax.routes'
import { portfoliosRoutes } from './modules/portfolios/portfolios.routes'
import { marketRoutes } from './modules/market/market.routes'
import { billingRoutes, billingWebhookHandler } from './modules/billing/billing.routes'
import { appConfigRoutes } from './modules/app-config/app-config.routes'
import { referralRoutes } from './modules/referral/referral.routes'
import { adminRoutes } from './modules/admin/admin.routes'
import { surveysRoutes } from './modules/surveys/surveys.routes'
import { announcementsRoutes } from './modules/announcements/announcements.routes'

export function createApp() {
  const app = express()

  app.use(helmet())
  // credentials: true → the browser may send/receive the httpOnly refresh cookie.
  // Allowed: exact origins from CORS_ORIGINS; additionally, in local mode, any
  // private-LAN origin so the app can be tested from another device (phone) on
  // the network without hardcoding the host IP. No wildcard in prod.
  const PRIVATE_LAN_ORIGIN =
    /^https?:\/\/(localhost|127\.0\.0\.1|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/
  const isLocal = env.APP_ENV === 'local'
  app.use(
    cors({
      origin(origin, cb) {
        // no Origin header = curl / same-origin / native shell → allow
        if (!origin) return cb(null, true)
        if (env.CORS_ORIGINS.includes(origin)) return cb(null, true)
        if (isLocal && PRIVATE_LAN_ORIGIN.test(origin)) return cb(null, true)
        cb(new Error('Not allowed by CORS'))
      },
      credentials: true,
    }),
  )
  app.use(cookieParser())

  // The Stripe webhook needs the unmodified raw body for signature verification —
  // so mount it with express.raw BEFORE express.json.
  app.post('/api/v1/billing/webhook', express.raw({ type: '*/*' }), billingWebhookHandler)

  app.use(express.json({ limit: '1mb' }))

  const api = express.Router()
  app.use('/api/v1', api)

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', env: env.APP_ENV })
  })

  // Public: native clients read this before login to gate on minimum version.
  api.use('/app', appConfigRoutes)

  api.use('/auth', authRoutes)
  api.use('/sources', sourcesRoutes)
  api.use('/portfolio', portfolioRoutes)
  api.use('/holdings', holdingsRoutes)
  api.use('/prices', pricesRoutes)
  api.use('/assets', assetsRoutes)
  api.use('/imports', importsRoutes)
  api.use('/transactions', transactionsRoutes)
  api.use('/tax', taxRoutes)
  api.use('/portfolios', portfoliosRoutes)
  api.use('/market', marketRoutes)
  api.use('/billing', billingRoutes)
  api.use('/referral', referralRoutes)
  api.use('/admin', adminRoutes)
  api.use('/surveys', surveysRoutes)
  api.use('/announcements', announcementsRoutes)

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route nicht gefunden' } })
  })
  app.use(errorMiddleware)

  return app
}
