import { Prisma, type CsvImport } from '@prisma/client'
import type { CsvImportDto, CsvUploadResponse, ImportErrorRow } from '@crypto-tracker/shared'
import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { parseCsv, suggestMappingWithPreset } from '../../csv/csv.parser'
import {
  applyBalanceMapping,
  applyTransactionMapping,
  type BalanceMapping,
  type TransactionMapping,
} from '../../csv/csv.mapper'
import { resolveAssetsBySymbol } from '../assets/asset-resolution.service'
import { refreshPrices } from '../../coingecko/price.service'
import { computeNetBalances } from '../transactions/tx-net-balance'

const PREVIEW_ROWS = 10

type ImportWithSource = CsvImport & { source: { label: string } }

function toImportDto(record: ImportWithSource): CsvImportDto {
  return {
    id: record.id,
    sourceId: record.sourceId,
    sourceLabel: record.source.label,
    filename: record.filename,
    kind: record.kind,
    status: record.status,
    totalRows: record.totalRows,
    importedRows: record.importedRows,
    errorRows: (record.errorRows as ImportErrorRow[] | null) ?? [],
    createdAt: record.createdAt.toISOString(),
  }
}

// Schritt 1: Datei hochladen → eigene CSV-Quelle + Import (PENDING_MAPPING) mit
// Roh-Zeilen und Mapping-Vorschlag. Bestände entstehen erst nach bestätigtem Mapping.
export async function uploadCsv(
  userId: string,
  file: { originalname: string; buffer: Buffer },
  kind: 'BALANCES' | 'TRANSACTIONS',
  label?: string,
): Promise<CsvUploadResponse> {
  const { headers, rows } = parseCsv(file.buffer.toString('utf8'))

  const source = await prisma.portfolioSource.create({
    data: {
      userId,
      type: 'CSV_IMPORT',
      provider: 'GENERIC_CSV',
      label: label?.trim() || file.originalname,
    },
  })
  const record = await prisma.csvImport.create({
    data: {
      sourceId: source.id,
      filename: file.originalname,
      kind,
      status: 'PENDING_MAPPING',
      rawPreview: { headers, rows: rows.slice(0, PREVIEW_ROWS) },
      rawRows: rows,
      totalRows: rows.length,
    },
    include: { source: { select: { label: true } } },
  })

  const { mapping, preset } = suggestMappingWithPreset(headers, kind)
  return {
    import: toImportDto(record),
    headers,
    preview: rows.slice(0, PREVIEW_ROWS),
    suggestedMapping: mapping,
    preset,
  }
}

// Schritt 2: Mapping bestätigen → Zeilen validieren, Holdings der CSV-Quelle ersetzen.
// Fehlerzeilen brechen den Import nicht ab — sie landen nachvollziehbar in errorRows.
type AnyMapping = BalanceMapping & Partial<TransactionMapping>

export async function confirmMapping(
  userId: string,
  importId: string,
  mapping: AnyMapping,
): Promise<CsvImportDto> {
  const record = await prisma.csvImport.findFirst({
    where: { id: importId, source: { userId } },
    include: { source: { select: { label: true } } },
  })
  if (!record) throw AppError.notFound('Import nicht gefunden')
  if (record.status !== 'PENDING_MAPPING') {
    throw AppError.conflict('IMPORT_ALREADY_DONE', 'Dieser Import wurde bereits ausgeführt')
  }

  const rows = (record.rawRows as Array<Record<string, string>> | null) ?? []
  const headers = ((record.rawPreview as { headers?: string[] }).headers ?? [])

  const requiredColumns =
    record.kind === 'TRANSACTIONS'
      ? [mapping.symbol, mapping.quantity, mapping.type, mapping.timestamp]
      : [mapping.symbol, mapping.quantity]
  const optionalColumns = [mapping.price, mapping.fee, mapping.currency]
  for (const column of requiredColumns) {
    if (!column || !headers.includes(column)) {
      throw AppError.badRequest('UNKNOWN_COLUMN', `Spalte „${column}" existiert nicht in der Datei`)
    }
  }
  for (const column of optionalColumns) {
    if (column && !headers.includes(column)) {
      throw AppError.badRequest('UNKNOWN_COLUMN', `Spalte „${column}" existiert nicht in der Datei`)
    }
  }

  if (record.kind === 'TRANSACTIONS') {
    return confirmTransactionImport(record, rows, mapping as TransactionMapping)
  }

  const { valid, errors } = applyBalanceMapping(rows, mapping)

  // Mehrfache Symbole in einer Datei aufsummieren
  const assetMap = await resolveAssetsBySymbol(valid.map((r) => r.symbol))
  const byAsset = new Map<string, Prisma.Decimal>()
  for (const row of valid) {
    const asset = assetMap.get(row.symbol)
    if (!asset) continue
    byAsset.set(asset.id, (byAsset.get(asset.id) ?? new Prisma.Decimal(0)).add(new Prisma.Decimal(row.quantity)))
  }

  const [, , updated] = await prisma.$transaction([
    prisma.holding.deleteMany({ where: { sourceId: record.sourceId } }),
    prisma.holding.createMany({
      data: [...byAsset.entries()].map(([assetId, quantity]) => ({
        sourceId: record.sourceId,
        assetId,
        quantity,
      })),
    }),
    prisma.csvImport.update({
      where: { id: record.id },
      data: {
        status: valid.length > 0 ? 'COMPLETED' : 'FAILED',
        columnMapping: { symbol: mapping.symbol, quantity: mapping.quantity },
        importedRows: valid.length,
        errorRows: errors as unknown as Prisma.InputJsonValue,
        rawRows: Prisma.DbNull, // Roh-Zeilen nach Ausführung nicht weiter vorhalten
      },
      include: { source: { select: { label: true } } },
    }),
  ])

  await refreshPrices([...byAsset.keys()])
  return toImportDto(updated)
}

// Transaktionen werden gespeichert (Nachvollziehbarkeit) und zu Netto-Beständen
// verdichtet: BUY/DEPOSIT zählen positiv, SELL/WITHDRAWAL negativ, TRANSFER/OTHER neutral.
// Keine PnL-/Kostenbasis-Berechnung in V1.
async function confirmTransactionImport(
  record: ImportWithSource,
  rows: Array<Record<string, string>>,
  mapping: TransactionMapping,
): Promise<CsvImportDto> {
  const { valid, errors } = applyTransactionMapping(rows, mapping)

  const assetMap = await resolveAssetsBySymbol(valid.map((r) => r.symbol))
  const netInput: Array<{ assetId: string; type: typeof valid[number]['type']; quantity: Prisma.Decimal }> = []
  const txRows: Prisma.TransactionCreateManyInput[] = []

  for (const row of valid) {
    const asset = assetMap.get(row.symbol)
    if (!asset) continue
    const quantity = new Prisma.Decimal(row.quantity)
    txRows.push({
      sourceId: record.sourceId,
      importId: record.id,
      assetId: asset.id,
      type: row.type,
      quantity,
      pricePerUnit: row.price ? new Prisma.Decimal(row.price) : null,
      feeAmount: row.fee ? new Prisma.Decimal(row.fee) : null,
      currency: row.currency ?? null,
      timestamp: row.timestamp,
    })
    netInput.push({ assetId: asset.id, type: row.type, quantity })
  }

  const holdings = computeNetBalances(netInput)

  const [, , , updated] = await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { sourceId: record.sourceId } }),
    prisma.transaction.createMany({ data: txRows }),
    prisma.holding.deleteMany({ where: { sourceId: record.sourceId } }),
    prisma.csvImport.update({
      where: { id: record.id },
      data: {
        status: valid.length > 0 ? 'COMPLETED' : 'FAILED',
        columnMapping: JSON.parse(JSON.stringify(mapping)),
        importedRows: valid.length,
        errorRows: errors as unknown as Prisma.InputJsonValue,
        rawRows: Prisma.DbNull,
      },
      include: { source: { select: { label: true } } },
    }),
  ])
  if (holdings.length > 0) {
    await prisma.holding.createMany({
      data: holdings.map((h) => ({ sourceId: record.sourceId, assetId: h.assetId, quantity: h.quantity })),
    })
  }

  await refreshPrices(holdings.map((h) => h.assetId))
  return toImportDto(updated)
}

export async function listImports(userId: string): Promise<CsvImportDto[]> {
  const records = await prisma.csvImport.findMany({
    where: { source: { userId } },
    include: { source: { select: { label: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return records.map(toImportDto)
}

// Import löschen = zugehörige CSV-Quelle löschen (Holdings + Import per Cascade)
export async function deleteImport(userId: string, importId: string): Promise<void> {
  const record = await prisma.csvImport.findFirst({ where: { id: importId, source: { userId } } })
  if (!record) throw AppError.notFound('Import nicht gefunden')
  await prisma.portfolioSource.delete({ where: { id: record.sourceId } })
}
