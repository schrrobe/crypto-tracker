import type { Request } from 'express'
import { AppError } from './errors'

// Route params are guaranteed by the route pattern; the check ensures this
// for TypeScript as well (noUncheckedIndexedAccess).
export function routeParam(req: Request, name: string): string {
  const value = req.params[name]
  if (!value) throw AppError.badRequest('BAD_PARAM', `Parameter ${name} fehlt`)
  return value
}
