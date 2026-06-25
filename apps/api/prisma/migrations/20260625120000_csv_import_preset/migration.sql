-- Persist the detected CSV export preset (KRAKEN/BITPANDA) on the import record
-- so confirm applies preset-specific parsing deterministically (no re-detection).
ALTER TABLE "CsvImport" ADD COLUMN "preset" TEXT;
