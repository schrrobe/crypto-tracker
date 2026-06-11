import { Router } from 'express'
import multer from 'multer'
import { confirmMappingSchema } from '@crypto-tracker/shared'
import { requireAuth } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { asyncHandler } from '../../lib/asyncHandler'
import { AppError } from '../../lib/errors'
import { routeParam } from '../../lib/params'
import * as importsService from './imports.service'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
})

export const importsRoutes = Router()
importsRoutes.use(requireAuth)

importsRoutes.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest('NO_FILE', 'Keine CSV-Datei übermittelt')
    const label = typeof req.body?.label === 'string' ? req.body.label : undefined
    const kind = req.body?.kind === 'TRANSACTIONS' ? 'TRANSACTIONS' : 'BALANCES'
    res.status(201).json(await importsService.uploadCsv(req.userId, req.file, kind, label))
  }),
)

importsRoutes.post(
  '/:id/mapping',
  validate(confirmMappingSchema),
  asyncHandler(async (req, res) => {
    res.json({
      import: await importsService.confirmMapping(req.userId, routeParam(req, 'id'), req.body.mapping),
    })
  }),
)

importsRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ imports: await importsService.listImports(req.userId) })
  }),
)

importsRoutes.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await importsService.deleteImport(req.userId, routeParam(req, 'id'))
    res.status(204).end()
  }),
)
