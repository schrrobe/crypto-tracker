import type { Request } from 'express'
import { AppError } from './errors'

// Route-Params sind durch das Routen-Pattern garantiert; der Check stellt das
// auch für TypeScript (noUncheckedIndexedAccess) sicher.
export function routeParam(req: Request, name: string): string {
  const value = req.params[name]
  if (!value) throw AppError.badRequest('BAD_PARAM', `Parameter ${name} fehlt`)
  return value
}
