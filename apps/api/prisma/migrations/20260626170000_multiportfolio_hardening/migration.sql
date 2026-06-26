-- Multi-Portfolio-Härtung
--
-- Genau eine automatisch verwaltete MANUAL-Quelle für manuelle Transaktionen
-- pro Portfolio. Frei angelegte MANUAL-Bestands-Buckets bleiben unberührt
-- (sie tragen einen anderen Label) — der partielle Unique-Index greift nur
-- für den reservierten Auto-Bucket-Label und schließt damit das Race in
-- getOrCreateManualTxSource: zwei parallele erste Transaktionen kollidieren
-- jetzt auf dem Index (P2002) statt zwei Quellen anzulegen.
-- Prisma kann partielle Indizes nicht abbilden — bewusst rohes SQL.
CREATE UNIQUE INDEX "PortfolioSource_manual_tx_bucket_key"
  ON "PortfolioSource" ("portfolioId")
  WHERE "type" = 'MANUAL' AND "label" = 'Manuelle Transaktionen';
