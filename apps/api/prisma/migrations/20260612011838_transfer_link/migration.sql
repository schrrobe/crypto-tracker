-- CreateTable
CREATE TABLE "TransferLink" (
    "id" TEXT NOT NULL,
    "withdrawalTxId" TEXT NOT NULL,
    "depositTxId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransferLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransferLink_withdrawalTxId_key" ON "TransferLink"("withdrawalTxId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferLink_depositTxId_key" ON "TransferLink"("depositTxId");

-- AddForeignKey
ALTER TABLE "TransferLink" ADD CONSTRAINT "TransferLink_withdrawalTxId_fkey" FOREIGN KEY ("withdrawalTxId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLink" ADD CONSTRAINT "TransferLink_depositTxId_fkey" FOREIGN KEY ("depositTxId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
