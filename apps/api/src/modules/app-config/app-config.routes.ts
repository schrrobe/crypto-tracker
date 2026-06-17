import { Router } from 'express'
import type { AppConfigDto } from '@crypto-tracker/shared'
import { env } from '../../config/env'

// Public (unauthenticated) endpoint: native clients read this on startup to
// decide whether their version is too old. Trivial enough to live in the route.
export const appConfigRoutes = Router()

appConfigRoutes.get('/config', (_req, res) => {
  const body: AppConfigDto = {
    minClientVersionAndroid: env.MIN_CLIENT_VERSION_ANDROID ?? null,
    minClientVersionIos: env.MIN_CLIENT_VERSION_IOS ?? null,
    storeUrlAndroid: env.APP_STORE_URL_ANDROID ?? null,
    storeUrlIos: env.APP_STORE_URL_IOS ?? null,
  }
  res.json(body)
})
