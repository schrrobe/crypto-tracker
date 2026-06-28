-- Admin dashboard stats: index the columns the stats queries filter/group on so
-- they stop sequential-scanning. activeSessions + the periodic token prune both
-- filter RefreshToken.expiresAt; the growth chart, overview period counts and
-- recent-signups feed all filter/order User.createdAt.

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
