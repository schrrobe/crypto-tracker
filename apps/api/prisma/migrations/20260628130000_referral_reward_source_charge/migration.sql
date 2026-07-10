-- Track the Stripe charge that funded a CONVERSION reward so a refund voids only
-- the matching reward (not any later refund on the same customer).

ALTER TABLE "ReferralReward" ADD COLUMN "stripeChargeId" TEXT;

CREATE INDEX "ReferralReward_stripeChargeId_idx" ON "ReferralReward"("stripeChargeId");
