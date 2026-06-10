import type { ErrorRequestHandler } from 'express'
import { AppError } from '../lib/errors'
import { env } from '../config/env'

export const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    })
    return
  }

  console.error('Unerwarteter Fehler:', err)
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: env.APP_ENV === 'local' ? String(err) : 'Interner Fehler',
    },
  })
}
