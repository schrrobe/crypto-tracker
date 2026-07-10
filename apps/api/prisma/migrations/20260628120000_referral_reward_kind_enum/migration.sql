-- Constrain ReferralReward.kind to the allowed reward kinds so the ledger can only
-- ever hold SIGNUP / CONVERSION (matches the DTO/service contract). Existing rows are
-- already one of these two values, so the USING cast converts them in place.

-- CreateEnum
CREATE TYPE "ReferralRewardKind" AS ENUM ('SIGNUP', 'CONVERSION');

-- AlterTable
ALTER TABLE "ReferralReward"
  ALTER COLUMN "kind" TYPE "ReferralRewardKind" USING "kind"::"ReferralRewardKind";
