import type { RequestHandler } from 'express'
import { verifyAccessToken } from '../lib/jwt'
import { AppError } from '../lib/errors'
import { prisma } from '../lib/prisma'

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

// Admin gate: valid Bearer token AND the user has isAdmin. Non-admins (and
// anonymous) get 404 — the admin surface does not reveal its existence.
export const requireAdmin: RequestHandler = (req, _res, next) => {
  requireAuth(req, _res, (err?: unknown) => {
    if (err) {
      next(AppError.notFound())
      return
    }
    prisma.user
      .findUnique({ where: { id: req.userId }, select: { isAdmin: true } })
      .then((user) => {
        if (!user?.isAdmin) {
          next(AppError.notFound())
          return
        }
        next()
      })
      .catch(next)
  })
}
