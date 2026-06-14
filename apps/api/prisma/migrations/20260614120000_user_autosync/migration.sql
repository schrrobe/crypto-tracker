-- AlterTable: automatischer Sync (nur für Pro wirksam)
ALTER TABLE "User" ADD COLUMN "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true;
