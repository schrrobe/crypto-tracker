import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import { env } from './config/env'
import { errorMiddleware } from './middleware/error.middleware'

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

  // Module werden hier registriert (auth, sources, portfolio, ...)

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route nicht gefunden' } })
  })
  app.use(errorMiddleware)

  return app
}
