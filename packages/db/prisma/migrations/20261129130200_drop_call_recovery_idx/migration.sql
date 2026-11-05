-- deferred
-- Sole statement so DROP INDEX CONCURRENTLY runs outside an implicit transaction.
DROP INDEX CONCURRENTLY IF EXISTS "messages_call_recovery_idx";
