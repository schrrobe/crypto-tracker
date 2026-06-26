-- Multi-Portfolio-Härtung
--
-- Genau eine automatisch verwaltete MANUAL-Quelle für manuelle Transaktionen
-- pro Portfolio. Frei angelegte MANUAL-Bestands-Buckets bleiben unberührt
-- (sie tragen einen anderen Label) — der partielle Unique-Index greift nur
-- für den reservierten Auto-Bucket-Label und schließt damit das Race in
-- getOrCreateManualTxSource: zwei parallele erste Transaktionen kollidieren
-- jetzt auf dem Index (P2002) statt zwei Quellen anzulegen.
-- Prisma kann partielle Indizes nicht abbilden — bewusst rohes SQL.

-- Dedupe vor dem Index: falls ein Portfolio bereits mehrere reservierte
-- MANUAL-Buckets hat, würde CREATE UNIQUE INDEX den Deploy abbrechen. Pro
-- Portfolio den ältesten Bucket behalten, alle Transaktionen der Duplikate
-- dorthin umhängen, die Duplikat-Quellen löschen (Holdings cascaden mit) und
-- anschließend die Holdings des behaltenen Buckets neu berechnen — nach
-- derselben Netto-Regel wie computeNetBalances (BUY/DEPOSIT/STAKING_REWARD +,
-- SELL/WITHDRAWAL -, asset-denominierte Gebühr abgezogen, nur positive Salden).
CREATE TEMP TABLE _dupe_keep AS
  SELECT "portfolioId",
         (array_agg(id ORDER BY "createdAt", id))[1] AS keep_id
  FROM "PortfolioSource"
  WHERE "type" = 'MANUAL' AND "label" = 'Manuelle Transaktionen'
  GROUP BY "portfolioId"
  HAVING count(*) > 1;

UPDATE "Transaction" t
  SET "sourceId" = k.keep_id
  FROM "PortfolioSource" ps
  JOIN _dupe_keep k ON k."portfolioId" = ps."portfolioId"
  WHERE t."sourceId" = ps.id
    AND ps.id <> k.keep_id
    AND ps."type" = 'MANUAL'
    AND ps."label" = 'Manuelle Transaktionen';

DELETE FROM "PortfolioSource" ps
  USING _dupe_keep k
  WHERE k."portfolioId" = ps."portfolioId"
    AND ps.id <> k.keep_id
    AND ps."type" = 'MANUAL'
    AND ps."label" = 'Manuelle Transaktionen';

DELETE FROM "Holding" WHERE "sourceId" IN (SELECT keep_id FROM _dupe_keep);

INSERT INTO "Holding" ("id", "sourceId", "assetId", "accountType", "quantity", "updatedAt")
SELECT gen_random_uuid(), x."sourceId", x."assetId", 'SPOT', x.q, now()
FROM (
  SELECT t."sourceId" AS "sourceId",
         t."assetId" AS "assetId",
         SUM(
           (CASE
             WHEN t."type" IN ('BUY', 'DEPOSIT', 'STAKING_REWARD') THEN t."quantity"
             WHEN t."type" IN ('SELL', 'WITHDRAWAL') THEN -t."quantity"
             ELSE 0
           END)
           - (CASE
               WHEN t."feeAmount" IS NOT NULL AND t."currency" = a."symbol" THEN t."feeAmount"
               ELSE 0
             END)
         ) AS q
  FROM "Transaction" t
  JOIN "Asset" a ON a.id = t."assetId"
  WHERE t."sourceId" IN (SELECT keep_id FROM _dupe_keep)
  GROUP BY t."sourceId", t."assetId"
) x
WHERE x.q > 0;

DROP TABLE _dupe_keep;

CREATE UNIQUE INDEX "PortfolioSource_manual_tx_bucket_key"
  ON "PortfolioSource" ("portfolioId")
  WHERE "type" = 'MANUAL' AND "label" = 'Manuelle Transaktionen';
