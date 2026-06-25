-- CreateEnum
CREATE TYPE "AnnouncementLevel" AS ENUM ('ERROR', 'INFO');

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "level" "AnnouncementLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_active_idx" ON "Announcement"("active");
