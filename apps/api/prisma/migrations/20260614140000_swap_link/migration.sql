-- CreateTable: Krypto-zu-Krypto-Tausch (SELL ↔ BUY)
CREATE TABLE "SwapLink" (
    "id" TEXT NOT NULL,
    "sellTxId" TEXT NOT NULL,
    "buyTxId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SwapLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SwapLink_sellTxId_key" ON "SwapLink"("sellTxId");
CREATE UNIQUE INDEX "SwapLink_buyTxId_key" ON "SwapLink"("buyTxId");
ALTER TABLE "SwapLink" ADD CONSTRAINT "SwapLink_sellTxId_fkey" FOREIGN KEY ("sellTxId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SwapLink" ADD CONSTRAINT "SwapLink_buyTxId_fkey" FOREIGN KEY ("buyTxId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
