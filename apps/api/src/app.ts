import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { env } from './config/env'
import { errorMiddleware } from './middleware/error.middleware'
import { authRoutes } from './modules/auth/auth.routes'
import { sourcesRoutes } from './modules/sources/sources.routes'
import { holdingsRoutes, portfolioRoutes, pricesRoutes } from './modules/portfolio/portfolio.routes'
import { assetsRoutes } from './modules/assets/assets.routes'
import { importsRoutes } from './modules/imports/imports.routes'
import { transactionsRoutes } from './modules/transactions/transactions.routes'

export function createApp() {
  const app = express()

  app.use(helmet())
  app.use(cors({ origin: env.CORS_ORIGINS }))
  app.use(express.json({ limit: '1mb' }))

  const api = express.Router()
  app.use('/api/v1', api)

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', env: env.APP_ENV })
  })

  api.use('/auth', authRoutes)
  api.use('/sources', sourcesRoutes)
  api.use('/portfolio', portfolioRoutes)
  api.use('/holdings', holdingsRoutes)
  api.use('/prices', pricesRoutes)
  api.use('/assets', assetsRoutes)
  api.use('/imports', importsRoutes)
  api.use('/transactions', transactionsRoutes)

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route nicht gefunden' } })
  })
  app.use(errorMiddleware)

  return app
}
