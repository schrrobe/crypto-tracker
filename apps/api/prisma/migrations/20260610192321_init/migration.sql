-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('EXCHANGE', 'WALLET', 'CSV_IMPORT', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProviderId" AS ENUM ('COINBASE', 'KRAKEN', 'BITVAVO', 'BITPANDA', 'BITCOIN', 'SOLANA', 'GENERIC_CSV', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING_MAPPING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('BALANCES', 'TRANSACTIONS');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "provider" "ProviderId" NOT NULL,
    "label" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeCredential" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "encryptedApiSecret" TEXT NOT NULL,
    "encryptedPassphrase" TEXT,
    "keyPreview" TEXT NOT NULL,

    CONSTRAINT "ExchangeCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletAddress" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,

    CONSTRAINT "WalletAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coingeckoId" TEXT,
    "iconUrl" TEXT,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "quantity" DECIMAL(38,18) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "importId" TEXT,
    "assetId" TEXT NOT NULL,
    "type" "TxType" NOT NULL,
    "quantity" DECIMAL(38,18) NOT NULL,
    "pricePerUnit" DECIMAL(38,18),
    "feeAmount" DECIMAL(38,18),
    "currency" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsvImport" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING_MAPPING',
    "columnMapping" JSONB,
    "rawPreview" JSONB NOT NULL,
    "rawRows" JSONB,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsvImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetPrice" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "priceEur" DECIMAL(24,8) NOT NULL,
    "priceUsd" DECIMAL(24,8) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "PortfolioSource_userId_idx" ON "PortfolioSource"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeCredential_sourceId_key" ON "ExchangeCredential"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletAddress_sourceId_key" ON "WalletAddress"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_coingeckoId_key" ON "Asset"("coingeckoId");

-- CreateIndex
CREATE INDEX "Asset_symbol_idx" ON "Asset"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_sourceId_assetId_key" ON "Holding"("sourceId", "assetId");

-- CreateIndex
CREATE INDEX "Transaction_sourceId_timestamp_idx" ON "Transaction"("sourceId", "timestamp");

-- CreateIndex
CREATE INDEX "CsvImport_sourceId_idx" ON "CsvImport"("sourceId");

-- CreateIndex
CREATE INDEX "SyncRun_sourceId_startedAt_idx" ON "SyncRun"("sourceId", "startedAt");

-- CreateIndex
CREATE INDEX "AssetPrice_assetId_fetchedAt_idx" ON "AssetPrice"("assetId", "fetchedAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioSource" ADD CONSTRAINT "PortfolioSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeCredential" ADD CONSTRAINT "ExchangeCredential_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PortfolioSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletAddress" ADD CONSTRAINT "WalletAddress_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PortfolioSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PortfolioSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PortfolioSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CsvImport" ADD CONSTRAINT "CsvImport_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PortfolioSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "PortfolioSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPrice" ADD CONSTRAINT "AssetPrice_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
