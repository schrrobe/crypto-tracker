import type { RequestHandler } from 'express'
import type { ZodTypeAny } from 'zod'
import { AppError } from '../lib/errors'

export function validate(schema: ZodTypeAny, target: 'body' | 'query' | 'params' = 'body'): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[target])
    if (!result.success) {
      next(
        AppError.badRequest(
          'VALIDATION_ERROR',
          'Ungültige Eingabe',
          result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
      )
      return
    }
    req[target] = result.data
    next()
  }
}
