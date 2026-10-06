-- CreateEnum
CREATE TYPE "MovementKind" AS ENUM ('OPENING', 'CHANGE');

-- CreateEnum
CREATE TYPE "MovementOrigin" AS ENUM ('SYNC', 'MANUAL', 'IMPORT');

-- AlterTable
ALTER TABLE "PortfolioSource" ADD COLUMN     "ledgerOpenedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "HoldingMovement" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "accountType" "HoldingAccountType" NOT NULL,
    "kind" "MovementKind" NOT NULL,
    "origin" "MovementOrigin" NOT NULL,
    "quantityBefore" DECIMAL(38,18) NOT NULL,
    "quantityAfter" DECIMAL(38,18) NOT NULL,
    "delta" DECIMAL(38,18) NOT NULL,
    "priceEur" DECIMAL(24,8),
    "priceUsd" DECIMAL(24,8),
    "syncRunId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HoldingMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HoldingMovement_sourceId_at_idx" ON "HoldingMovement"("sourceId", "at");

-- CreateIndex
CREATE INDEX "HoldingMovement_assetId_idx" ON "HoldingMovement"("assetId");

-- AddForeignKey
ALTER TABLE "HoldingMovement" ADD CONSTRAINT "HoldingMovement_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PortfolioSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldingMovement" ADD CONSTRAINT "HoldingMovement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoldingMovement" ADD CONSTRAINT "HoldingMovement_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: Bestandsdaten erhalten ihren Anfangsbestand (OPENING) zum aktuellen
-- Stand, bewertet mit dem letzten bekannten Kurs. Damit stimmt die Invariante
-- „Summe der Deltas = aktueller Bestand“ ab dem ersten Tag.
INSERT INTO "HoldingMovement" (
    "id", "sourceId", "assetId", "accountType", "kind", "origin",
    "quantityBefore", "quantityAfter", "delta", "priceEur", "priceUsd", "at"
)
SELECT
    gen_random_uuid()::text,
    h."sourceId",
    h."assetId",
    h."accountType",
    'OPENING'::"MovementKind",
    CASE WHEN s."type" = 'MANUAL' THEN 'MANUAL'::"MovementOrigin"
         WHEN s."type" = 'CSV_IMPORT' THEN 'IMPORT'::"MovementOrigin"
         ELSE 'SYNC'::"MovementOrigin" END,
    0,
    h."quantity",
    h."quantity",
    p."priceEur",
    p."priceUsd",
    CURRENT_TIMESTAMP
FROM "Holding" h
JOIN "PortfolioSource" s ON s."id" = h."sourceId"
LEFT JOIN (
    SELECT DISTINCT ON ("assetId") "assetId", "priceEur", "priceUsd"
    FROM "AssetPrice"
    ORDER BY "assetId", "fetchedAt" DESC
) p ON p."assetId" = h."assetId";

-- Bereits genutzte Quellen gelten als eröffnet; spätere Abgleiche buchen CHANGE.
UPDATE "PortfolioSource" s
SET "ledgerOpenedAt" = CURRENT_TIMESTAMP
WHERE s."lastSyncAt" IS NOT NULL
   OR s."type" = 'MANUAL'
   OR EXISTS (SELECT 1 FROM "Holding" h WHERE h."sourceId" = s."id");
