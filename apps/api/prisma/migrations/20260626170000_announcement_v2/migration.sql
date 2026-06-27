-- Announcement broadcast banner v2.
-- All new columns carry defaults so the migration is safe on a populated table.

ALTER TABLE "Announcement"
  ADD COLUMN "messages" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'de',
  ADD COLUMN "dismissible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "public" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: seed the locale map from the existing single message under the
-- default locale, so existing rows render unchanged after the read switch.
UPDATE "Announcement"
  SET "messages" = jsonb_build_object("defaultLocale", "message")
  WHERE "message" IS NOT NULL AND "message" <> '';

-- Index the public-visibility filter used by GET /announcements/public.
CREATE INDEX "Announcement_public_active_idx" ON "Announcement" ("public", "active");
