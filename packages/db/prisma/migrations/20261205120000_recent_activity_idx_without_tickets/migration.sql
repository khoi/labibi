-- Runs are empty after the chats migration, and the previous release's query still matches.
DROP INDEX "runs_recent_activity_idx";
CREATE INDEX "runs_recent_activity_idx"
ON "runs" ("spaceId", "userId", "completedAt" DESC, "updatedAt" DESC, "id" DESC)
WHERE "status" IN ('completed', 'failed', 'cancelled');
