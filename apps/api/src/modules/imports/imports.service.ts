import { createHash } from 'node:crypto'
import { Prisma, type CsvImport } from '@prisma/client'
import { EXCHANGE_PROVIDERS, type CsvImportDto, type CsvUploadResponse, type ImportErrorRow } from '@crypto-tracker/shared'
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
import { computeNetBalances, type NetBalanceTx } from '../transactions/tx-net-balance'
import { resolvePortfolioId } from '../portfolios/portfolios.service'

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

// Step 1: upload file → dedicated CSV source + import (PENDING_MAPPING) with
// raw rows and a suggested mapping. Holdings are only created after the mapping is confirmed.
export async function uploadCsv(
  userId: string,
  file: { originalname: string; buffer: Buffer },
  kind: 'BALANCES' | 'TRANSACTIONS',
  label?: string,
  portfolioId?: string,
  exchange?: (typeof EXCHANGE_PROVIDERS)[number],
): Promise<CsvUploadResponse> {
  const pid = await resolvePortfolioId(userId, portfolioId)
  const { headers, rows } = parseCsv(file.buffer.toString('utf8'))

  // Detect re-upload of the same file in the same portfolio: each upload creates
  // its own CSV source, so an identical file would otherwise be counted twice.
  const contentHash = createHash('sha256').update(file.buffer).digest('hex')
  const priorImport = await prisma.csvImport.findFirst({
    where: { contentHash, source: { userId, portfolioId: pid } },
    select: { source: { select: { label: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const duplicateCsvSource = priorImport?.source.label ?? null

  const source = await prisma.portfolioSource.create({
    data: {
      userId,
      portfolioId: pid,
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
      contentHash,
    },
    include: { source: { select: { label: true } } },
  })

  const { mapping, preset } = suggestMappingWithPreset(headers, kind)

  // Active duplicate detection: exchange either chosen explicitly (covers all 11)
  // or detected via preset (KRAKEN/BITPANDA = ProviderId). If an API source for the
  // same exchange already exists in the same portfolio, the import would count the
  // same balances a second time.
  const candidateProvider = exchange ?? preset ?? null
  let duplicateExchangeSource: string | null = null
  let duplicateExchangeProvider: (typeof EXCHANGE_PROVIDERS)[number] | null = null
  if (candidateProvider) {
    const existing = await prisma.portfolioSource.findFirst({
      where: { userId, portfolioId: pid, type: 'EXCHANGE', provider: candidateProvider },
      select: { label: true },
    })
    if (existing) {
      duplicateExchangeSource = existing.label
      duplicateExchangeProvider = candidateProvider
    }
  }

  return {
    import: toImportDto(record),
    headers,
    preview: rows.slice(0, PREVIEW_ROWS),
    suggestedMapping: mapping,
    preset,
    duplicateExchangeSource,
    duplicateExchangeProvider,
    duplicateCsvSource,
  }
}

// Step 2: confirm mapping → validate rows, replace the CSV source's holdings.
// Error rows do not abort the import — they are recorded traceably in errorRows.
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

  // Sum up duplicate symbols within a single file
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
        rawRows: Prisma.DbNull, // do not retain raw rows after execution
      },
      include: { source: { select: { label: true } } },
    }),
  ])

  await refreshPrices([...byAsset.keys()])
  return toImportDto(updated)
}

// Transactions are stored (for traceability) and condensed into net balances:
// BUY/DEPOSIT count positive, SELL/WITHDRAWAL negative, TRANSFER/OTHER neutral.
// No PnL/cost-basis calculation in V1.
async function confirmTransactionImport(
  record: ImportWithSource,
  rows: Array<Record<string, string>>,
  mapping: TransactionMapping,
): Promise<CsvImportDto> {
  const { valid, errors } = applyTransactionMapping(rows, mapping)

  const assetMap = await resolveAssetsBySymbol(valid.map((r) => r.symbol))
  const symbolByAssetId = new Map<string, string>()
  const netInput: NetBalanceTx[] = []
  const txRows: Prisma.TransactionCreateManyInput[] = []

  for (const row of valid) {
    const asset = assetMap.get(row.symbol)
    if (!asset) continue
    symbolByAssetId.set(asset.id, row.symbol)
    const quantity = new Prisma.Decimal(row.quantity)
    const fee = row.fee ? new Prisma.Decimal(row.fee) : null
    txRows.push({
      sourceId: record.sourceId,
      importId: record.id,
      assetId: asset.id,
      type: row.type,
      quantity,
      pricePerUnit: row.price ? new Prisma.Decimal(row.price) : null,
      feeAmount: fee,
      currency: row.currency ?? null,
      timestamp: row.timestamp,
    })
    netInput.push({
      assetId: asset.id,
      type: row.type,
      quantity,
      fee,
      // Only subtract the fee when the row explicitly records its currency as the
      // asset itself. The fee currency is otherwise unknown (most exports omit it
      // or only record the price/quote currency), and assuming "asset" would wrongly
      // subtract fiat fees — so when in doubt we do not touch the balance.
      feeInAsset: !!fee && !!row.currency && row.currency === row.symbol,
    })
  }

  const { holdings, nonPositiveAssetIds } = computeNetBalances(netInput)
  // Surface assets that netted to <= 0 (more sells than buys) so the user notices
  // an incomplete history instead of the asset silently vanishing from holdings.
  for (const assetId of nonPositiveAssetIds) {
    const symbol = symbolByAssetId.get(assetId) ?? assetId
    errors.push({
      line: 0,
      raw: symbol,
      code: 'csv.noticeNonPositiveNet',
      params: { symbol },
      error: `Asset „${symbol}": Nettobestand ≤ 0 (mehr Verkäufe als Käufe — unvollständige Historie?) — nicht als Bestand übernommen`,
    })
  }

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

export async function listImports(userId: string, portfolioId?: string): Promise<CsvImportDto[]> {
  const pid = await resolvePortfolioId(userId, portfolioId)
  const records = await prisma.csvImport.findMany({
    where: { source: { userId, portfolioId: pid } },
    include: { source: { select: { label: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return records.map(toImportDto)
}

// Deleting an import = deleting the associated CSV source (holdings + import via cascade)
export async function deleteImport(userId: string, importId: string): Promise<void> {
  const record = await prisma.csvImport.findFirst({ where: { id: importId, source: { userId } } })
  if (!record) throw AppError.notFound('Import nicht gefunden')
  await prisma.portfolioSource.delete({ where: { id: record.sourceId } })
}
