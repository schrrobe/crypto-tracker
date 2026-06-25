-- Scope Transaction.externalRef uniqueness to the owning source.
-- A global unique index silently dropped a reward (skipDuplicates) when two
-- users tracked the same public validator / stake account (identical refs like
-- eth-wd:12345 or sol-reward:<pubkey>:<epoch>), under-reporting taxable income.

-- DropIndex
DROP INDEX "Transaction_externalRef_key";

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_sourceId_externalRef_key" ON "Transaction"("sourceId", "externalRef");
