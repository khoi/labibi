-- A person's runs in a workspace, newest first: computer idle checks and home retention read them.
CREATE INDEX "runs_spaceId_userId_createdAt_idx" ON "runs"("spaceId", "userId", "createdAt");
