-- Referral hardening: commission lifecycle, clearing window, reversal, payout
-- status + bank snapshot, referredUser FK. Additive + backfill, no destructive drops.

-- Enums
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PAID', 'REVERSED');
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED', 'SETTLED', 'FAILED', 'CANCELLED');

-- ReferralCommission: new columns
ALTER TABLE "ReferralCommission"
  ADD COLUMN "stripeChargeId" TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "payableAt" TIMESTAMP(3),
  ADD COLUMN "reversedAt" TIMESTAMP(3),
  ADD COLUMN "reversalReason" TEXT;

-- Backfill payableAt for existing rows (clear immediately: their clearing window has passed).
UPDATE "ReferralCommission" SET "payableAt" = "createdAt" WHERE "payableAt" IS NULL;
ALTER TABLE "ReferralCommission" ALTER COLUMN "payableAt" SET NOT NULL;

-- Backfill status from the old nullable-column model.
UPDATE "ReferralCommission" SET "status" = 'REVERSED', "reversedAt" = "voidedAt", "reversalReason" = 'admin_void' WHERE "voidedAt" IS NOT NULL;
UPDATE "ReferralCommission" SET "status" = 'PAID' WHERE "payoutId" IS NOT NULL AND "voidedAt" IS NULL;
-- Legacy unpaid, non-voided rows are past their (backfilled) clearing window → CONFIRMED.
UPDATE "ReferralCommission" SET "status" = 'CONFIRMED' WHERE "payoutId" IS NULL AND "voidedAt" IS NULL;

-- referredUserId becomes nullable so a deleted referred user can SET NULL.
ALTER TABLE "ReferralCommission" ALTER COLUMN "referredUserId" DROP NOT NULL;

-- Null out orphans BEFORE adding the FK: the old column had no FK, so a deleted
-- referred user could leave a dangling id. Without this the ADD CONSTRAINT below
-- fails on deploy against any DB that has such rows.
UPDATE "ReferralCommission" SET "referredUserId" = NULL
  WHERE "referredUserId" IS NOT NULL
    AND "referredUserId" NOT IN (SELECT "id" FROM "User");

-- Indexes for settle/earnings sweeps and refund lookup.
CREATE INDEX "ReferralCommission_referrerId_currency_status_idx" ON "ReferralCommission"("referrerId", "currency", "status");
CREATE INDEX "ReferralCommission_status_payableAt_idx" ON "ReferralCommission"("status", "payableAt");
CREATE INDEX "ReferralCommission_stripeChargeId_idx" ON "ReferralCommission"("stripeChargeId");
-- FK index: ON DELETE SET NULL on referredUserId would otherwise scan the table on user deletes.
CREATE INDEX "ReferralCommission_referredUserId_idx" ON "ReferralCommission"("referredUserId");

-- Referential integrity for the referred user.
ALTER TABLE "ReferralCommission" ADD CONSTRAINT "ReferralCommission_referredUserId_fkey"
  FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Payout: status lifecycle, failure reason, frozen bank snapshot.
ALTER TABLE "Payout"
  ADD COLUMN "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED',
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "snapshotIban" TEXT,
  ADD COLUMN "snapshotIbanPreview" TEXT,
  ADD COLUMN "snapshotBic" TEXT,
  ADD COLUMN "snapshotHolder" TEXT;

-- Pre-existing payouts represent transfers already made → treat as SETTLED.
UPDATE "Payout" SET "status" = 'SETTLED';
