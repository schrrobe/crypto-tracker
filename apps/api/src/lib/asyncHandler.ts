import type { NextFunction, Request, RequestHandler, Response } from 'express'

// Express 4 fängt Promise-Rejections nicht selbst — Wrapper leitet sie an den Error-Handler
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}
