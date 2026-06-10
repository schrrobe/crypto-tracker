import type { RequestHandler } from 'express'
import { verifyAccessToken } from '../lib/jwt'
import { AppError } from '../lib/errors'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string
    }
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
  const userId = token ? verifyAccessToken(token) : null
  if (!userId) {
    next(AppError.unauthorized())
    return
  }
  req.userId = userId
  next()
}
