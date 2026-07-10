/*
  Warnings:

  - You are about to drop the column `bankBic` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `bankHolder` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `encryptedIban` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `ibanPreview` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `Payout` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReferralCommission` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Payout" DROP CONSTRAINT "Payout_referrerId_fkey";

-- DropForeignKey
ALTER TABLE "ReferralCommission" DROP CONSTRAINT "ReferralCommission_payoutId_fkey";

-- DropForeignKey
ALTER TABLE "ReferralCommission" DROP CONSTRAINT "ReferralCommission_referrerId_fkey";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "bankBic",
DROP COLUMN "bankHolder",
DROP COLUMN "encryptedIban",
DROP COLUMN "ibanPreview",
ADD COLUMN     "referralProUntil" TIMESTAMP(3);

-- DropTable
DROP TABLE "Payout";

-- DropTable
DROP TABLE "ReferralCommission";

-- CreateTable
CREATE TABLE "ReferralReward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "referredUserId" TEXT,
    "grantedDays" INTEGER NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReferralReward_idempotencyKey_key" ON "ReferralReward"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ReferralReward_userId_idx" ON "ReferralReward"("userId");

-- AddForeignKey
ALTER TABLE "ReferralReward" ADD CONSTRAINT "ReferralReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
