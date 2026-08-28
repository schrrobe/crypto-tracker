-- Financial referral history must survive account deletion. Snapshot the email
-- used by admin reporting and remove the cascading user foreign keys while
-- retaining the immutable user id as a plain audit identifier.

ALTER TABLE "ReferralCommission" ADD COLUMN "referrerEmail" TEXT;
UPDATE "ReferralCommission" c
SET "referrerEmail" = u."email"
FROM "User" u
WHERE u."id" = c."referrerId";
ALTER TABLE "ReferralCommission" ALTER COLUMN "referrerEmail" SET NOT NULL;
ALTER TABLE "ReferralCommission" DROP CONSTRAINT "ReferralCommission_referrerId_fkey";

ALTER TABLE "Payout" ADD COLUMN "referrerEmail" TEXT;
UPDATE "Payout" p
SET "referrerEmail" = u."email"
FROM "User" u
WHERE u."id" = p."referrerId";
ALTER TABLE "Payout" ALTER COLUMN "referrerEmail" SET NOT NULL;
ALTER TABLE "Payout" DROP CONSTRAINT "Payout_referrerId_fkey";

-- A short-lived local reservation closes the duplicate Checkout window before
-- Stripe has delivered the subscription webhook.
ALTER TABLE "User" ADD COLUMN "stripeCheckoutPendingUntil" TIMESTAMP(3);

-- Portfolio labels are a user-facing tax-subject identifier and must remain
-- unique even under concurrent create/rename requests.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Portfolio"
    GROUP BY "userId", lower(btrim("label"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce normalized portfolio-label uniqueness: duplicate labels exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "Portfolio_userId_normalized_label_key"
  ON "Portfolio" ("userId", lower(btrim("label")));
