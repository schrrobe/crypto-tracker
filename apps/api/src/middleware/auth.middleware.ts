import type { RequestHandler } from 'express'
import { verifyAccessToken } from '../lib/jwt'
import { AppError } from '../lib/errors'
import { prisma } from '../lib/prisma'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string
      adminUser: { id: string; email: string }
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
  // Access tokens live for 15 minutes. Re-check the account so deletion and an
  // admin suspension revoke that access immediately instead of leaving global
  // authenticated mutations available until JWT expiry.
  prisma.user
    .findUnique({ where: { id: userId }, select: { suspendedAt: true } })
    .then((user) => {
      if (!user) {
        next(AppError.unauthorized())
        return
      }
      if (user.suspendedAt) {
        next(new AppError('ACCOUNT_SUSPENDED', 403, 'Dieses Konto ist gesperrt'))
        return
      }
      req.userId = userId
      next()
    })
    .catch(next)
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
      .findUnique({ where: { id: req.userId }, select: { id: true, email: true, isAdmin: true } })
      .then((user) => {
        if (!user?.isAdmin) {
          next(AppError.notFound())
          return
        }
        req.adminUser = { id: user.id, email: user.email }
        next()
      })
      .catch(next)
  })
}
