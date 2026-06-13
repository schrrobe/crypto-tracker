-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Portfolio_userId_idx" ON "Portfolio"("userId");

-- Maximal ein Default-Portfolio pro User (partieller Unique-Index — bewusst
-- rohes SQL, Prisma kann WHERE-Indizes nicht abbilden)
CREATE UNIQUE INDEX "Portfolio_userId_default_key" ON "Portfolio"("userId") WHERE "isDefault";

-- Backfill: Default-Portfolio je bestehendem User
INSERT INTO "Portfolio" ("id", "userId", "label", "isDefault")
SELECT gen_random_uuid(), "id", 'Mein Portfolio', true FROM "User";

-- PortfolioSource an Portfolios hängen (erst nullable, dann backfillen, dann NOT NULL)
ALTER TABLE "PortfolioSource" ADD COLUMN "portfolioId" TEXT;

UPDATE "PortfolioSource" s SET "portfolioId" = p."id"
FROM "Portfolio" p WHERE p."userId" = s."userId" AND p."isDefault";

ALTER TABLE "PortfolioSource" ALTER COLUMN "portfolioId" SET NOT NULL;

ALTER TABLE "PortfolioSource" ADD CONSTRAINT "PortfolioSource_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PortfolioSource_portfolioId_idx" ON "PortfolioSource"("portfolioId");
