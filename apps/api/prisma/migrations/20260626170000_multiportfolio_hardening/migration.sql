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
-- MANUAL-Buckets hat, würde CREATE UNIQUE INDEX den Deploy abbrechen. Den
-- ältesten Bucket je Portfolio behalten, dessen Transaktionen umhängen,
-- die (aus Transaktionen ableitbaren) Holdings der Duplikate verwerfen und
-- die überzähligen Quellen löschen.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id,
           first_value(id) OVER (
             PARTITION BY "portfolioId" ORDER BY "createdAt", id
           ) AS keep_id,
           row_number() OVER (
             PARTITION BY "portfolioId" ORDER BY "createdAt", id
           ) AS rn
    FROM "PortfolioSource"
    WHERE "type" = 'MANUAL' AND "label" = 'Manuelle Transaktionen'
  LOOP
    IF r.rn > 1 THEN
      UPDATE "Transaction" SET "sourceId" = r.keep_id WHERE "sourceId" = r.id;
      DELETE FROM "Holding" WHERE "sourceId" = r.id;
      DELETE FROM "PortfolioSource" WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX "PortfolioSource_manual_tx_bucket_key"
  ON "PortfolioSource" ("portfolioId")
  WHERE "type" = 'MANUAL' AND "label" = 'Manuelle Transaktionen';
