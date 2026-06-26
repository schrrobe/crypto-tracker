-- AssetPrice idempotent machen: bucketAt (fetchedAt auf Minute, UTC) + unique(assetId,bucketAt).
-- Sequenz bewusst mehrstufig, weil die Tabelle Bestandsdaten (inkl. Duplikate, der zu
-- behebende Bug) enthält: nullable Spalte -> backfill -> dedupe -> unique index -> not null.

-- 1) Spalte zunächst nullable hinzufügen (kein Default: App setzt bucketAt explizit).
ALTER TABLE "AssetPrice" ADD COLUMN "bucketAt" TIMESTAMP(3);

-- 2) Backfill: vorhandene Zeilen auf ihre Minute abschneiden.
UPDATE "AssetPrice" SET "bucketAt" = date_trunc('minute', "fetchedAt") WHERE "bucketAt" IS NULL;

-- 3) Dedupe vor dem Unique-Index: je (assetId, bucketAt) nur die jüngste Zeile behalten
--    (höchstes fetchedAt, bei Gleichstand höchste id). Ältere Kollisionen löschen.
DELETE FROM "AssetPrice" a
USING "AssetPrice" b
WHERE a."assetId" = b."assetId"
  AND a."bucketAt" = b."bucketAt"
  AND (a."fetchedAt" < b."fetchedAt" OR (a."fetchedAt" = b."fetchedAt" AND a."id" < b."id"));

-- 4) Defensiver Re-Pass UNMITTELBAR vor Index/NOT-NULL: unter READ COMMITTED kann eine
--    noch laufende alte App-Instanz zwischen Schritt 2 und hier Zeilen mit bucketAt=NULL
--    committed haben. Diese würden das spätere SET NOT NULL kippen (NULLs verletzen den
--    Unique-Index NICHT) und die Tabelle halb migriert hinterlassen. Re-Backfill + Re-Dedupe
--    schließt das Fenster auf Mikrosekunden. Für echtes Zero-Downtime-Deployment die
--    bucketAt-schreibende App-Version VOR dieser Migration ausrollen.
UPDATE "AssetPrice" SET "bucketAt" = date_trunc('minute', "fetchedAt") WHERE "bucketAt" IS NULL;
DELETE FROM "AssetPrice" a
USING "AssetPrice" b
WHERE a."assetId" = b."assetId"
  AND a."bucketAt" = b."bucketAt"
  AND (a."fetchedAt" < b."fetchedAt" OR (a."fetchedAt" = b."fetchedAt" AND a."id" < b."id"));

-- 5) Unique-Index (jetzt kollisionsfrei) + not null.
CREATE UNIQUE INDEX "AssetPrice_assetId_bucketAt_key" ON "AssetPrice"("assetId", "bucketAt");
ALTER TABLE "AssetPrice" ALTER COLUMN "bucketAt" SET NOT NULL;
