import type { NextFunction, Request, RequestHandler, Response } from 'express'

// Express 4 does not catch promise rejections itself — the wrapper forwards them to the error handler
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}
