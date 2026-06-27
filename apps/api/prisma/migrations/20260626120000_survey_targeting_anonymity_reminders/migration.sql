-- Surveys: anonymity, targeting (plan/currency), and reminder cooldown.

-- Anonymous flag: when true, userId is never surfaced in results/free-text/CSV.
ALTER TABLE "Survey" ADD COLUMN "anonymous" BOOLEAN NOT NULL DEFAULT false;

-- Targeting axes. Empty array (the default) means "no restriction on this axis".
-- NOT NULL: schema.prisma models these as required lists and the services call
-- .length on them, so a NULL would break the survey list/results paths.
ALTER TABLE "Survey" ADD COLUMN "targetPlans" "Plan"[] NOT NULL DEFAULT ARRAY[]::"Plan"[];
ALTER TABLE "Survey" ADD COLUMN "targetCurrencies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Cooldown anchor for the "remind non-responders" admin action.
ALTER TABLE "Survey" ADD COLUMN "lastRemindedAt" TIMESTAMP(3);
