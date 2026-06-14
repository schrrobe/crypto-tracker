-- CreateEnum
CREATE TYPE "HoldingAccountType" AS ENUM ('SPOT', 'EARN', 'MARGIN', 'FUTURES');

-- CreateEnum
CREATE TYPE "PositionSide" AS ENUM ('LONG', 'SHORT');

-- AlterTable: Bestandskonto-Typ; Altdaten sind alle SPOT
ALTER TABLE "Holding" ADD COLUMN "accountType" "HoldingAccountType" NOT NULL DEFAULT 'SPOT';

-- Unique von (sourceId, assetId) auf (sourceId, assetId, accountType) erweitern
DROP INDEX "Holding_sourceId_assetId_key";
CREATE UNIQUE INDEX "Holding_sourceId_assetId_accountType_key" ON "Holding"("sourceId", "assetId", "accountType");

-- CreateTable
CREATE TABLE "FuturesPosition" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "assetId" TEXT,
    "rawSymbol" TEXT NOT NULL,
    "side" "PositionSide" NOT NULL,
    "size" DECIMAL(38,18) NOT NULL,
    "entryPrice" DECIMAL(38,8),
    "markPrice" DECIMAL(38,8),
    "leverage" INTEGER,
    "unrealizedPnl" DECIMAL(38,8),
    "quoteCurrency" TEXT,
    "liquidationPrice" DECIMAL(38,8),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FuturesPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FuturesPosition_sourceId_rawSymbol_side_key" ON "FuturesPosition"("sourceId", "rawSymbol", "side");

-- AddForeignKey
ALTER TABLE "FuturesPosition" ADD CONSTRAINT "FuturesPosition_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PortfolioSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuturesPosition" ADD CONSTRAINT "FuturesPosition_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
