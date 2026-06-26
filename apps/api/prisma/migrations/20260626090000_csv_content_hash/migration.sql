-- AlterTable
ALTER TABLE "CsvImport" ADD COLUMN "contentHash" TEXT;

-- CreateIndex
CREATE INDEX "CsvImport_contentHash_idx" ON "CsvImport"("contentHash");
