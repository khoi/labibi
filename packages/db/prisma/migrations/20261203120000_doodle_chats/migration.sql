-- One Doodle per workspace and chats with members replace bots, their threads and groups.
-- A declared one-time break: every chat and everything a bot owned is deleted first.

DELETE FROM "secrets" WHERE "id" IN (
  SELECT "webhookSecretId" FROM "bots" WHERE "webhookSecretId" IS NOT NULL
  UNION SELECT "shareSecretId" FROM "pages" WHERE "shareSecretId" IS NOT NULL
  UNION SELECT "secretId" FROM "browser_profiles" WHERE "secretId" IS NOT NULL
);
DELETE FROM "routines";
DELETE FROM "threads";
DELETE FROM "chat_groups";
DELETE FROM "memory_documents";
DELETE FROM "artifacts";
DELETE FROM "pages";
DELETE FROM "taught_skills";
DELETE FROM "browser_profiles";
DELETE FROM "agent_homes";
DELETE FROM "computer_execution_leases";
DELETE FROM "computer_updates";
DELETE FROM "bots";
DELETE FROM "bot_deletions";
-- A person's own Team Computer stays as their computer in that workspace; dedicated computers
-- and ones handed on when someone left go.
DELETE FROM "computers" WHERE "scopeKey" IS DISTINCT FROM ('team:' || "spaceId" || ':' || "userId");

DROP TRIGGER "revoke_bot_screens" ON "bots";
DROP FUNCTION "revoke_bot_screens"();

ALTER TABLE "agent_homes" DROP CONSTRAINT "agent_homes_botId_fkey";
ALTER TABLE "agent_homes" DROP CONSTRAINT "agent_homes_spaceId_fkey";
ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_botId_fkey";
ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_groupId_fkey";
ALTER TABLE "bot_deletions" DROP CONSTRAINT "bot_deletions_spaceId_fkey";
ALTER TABLE "bots" DROP CONSTRAINT "bots_computerId_fkey";
ALTER TABLE "browser_profiles" DROP CONSTRAINT "browser_profiles_botId_fkey";
ALTER TABLE "chat_group_members" DROP CONSTRAINT "chat_group_members_botId_fkey";
ALTER TABLE "chat_group_members" DROP CONSTRAINT "chat_group_members_groupId_fkey";
ALTER TABLE "chat_groups" DROP CONSTRAINT "chat_groups_spaceId_fkey";
ALTER TABLE "memory_documents" DROP CONSTRAINT "memory_documents_botId_fkey";
ALTER TABLE "pages" DROP CONSTRAINT "pages_botId_fkey";
ALTER TABLE "pages" DROP CONSTRAINT "pages_groupId_fkey";
ALTER TABLE "routines" DROP CONSTRAINT "routines_threadId_fkey";
ALTER TABLE "taught_skills" DROP CONSTRAINT "taught_skills_botId_fkey";
ALTER TABLE "threads" DROP CONSTRAINT "threads_botId_fkey";
ALTER TABLE "threads" DROP CONSTRAINT "threads_groupId_fkey";
ALTER TABLE "threads" DROP CONSTRAINT "threads_owner_chk";

DROP INDEX "artifacts_groupId_idx";
DROP INDEX "artifacts_spaceId_botId_idx";
DROP INDEX "bots_computerId_idx";
DROP INDEX "bots_spaceId_userId_archivedAt_updatedAt_idx";
DROP INDEX "browser_profiles_botId_key";
DROP INDEX "computer_execution_leases_botId_expiresAt_idx";
DROP INDEX "computer_execution_leases_computerId_botId_key";
DROP INDEX "computer_execution_leases_computerId_expiresAt_idx";
DROP INDEX "computers_spaceId_scope_idx";
DROP INDEX "memory_documents_spaceId_scope_botId_path_key";
DROP INDEX "pages_botId_idx";
DROP INDEX "pages_groupId_idx";
DROP INDEX "routines_spaceId_botId_idx";
DROP INDEX "taught_skills_botId_recording_key";
DROP INDEX "taught_skills_spaceId_botId_idx";
DROP INDEX "taught_skills_spaceId_botId_status_idx";
DROP INDEX "threads_botId_key";
DROP INDEX "threads_groupId_key";

DROP TABLE "agent_homes";
DROP TABLE "bot_deletions";
DROP TABLE "chat_group_members";
DROP TABLE "chat_groups";

ALTER TABLE "artifacts" DROP COLUMN "botId",
DROP COLUMN "groupId",
ADD COLUMN "threadId" TEXT NOT NULL;

ALTER TABLE "bots" DROP COLUMN "archivedAt",
DROP COLUMN "autoSpeak",
DROP COLUMN "color",
DROP COLUMN "computerId",
DROP COLUMN "computerSwitching",
DROP COLUMN "memoryScope",
DROP COLUMN "name",
DROP COLUMN "notifyOnFinish",
DROP COLUMN "screenGeneration",
DROP COLUMN "userId",
DROP COLUMN "webhookSecretId";

ALTER TABLE "browser_profiles" DROP COLUMN "botId";
ALTER TABLE "computer_execution_leases" DROP COLUMN "botId";
ALTER TABLE "computer_updates" DROP COLUMN "botId";

ALTER TABLE "computers" DROP COLUMN "controlBotId",
DROP COLUMN "executionBotId",
DROP COLUMN "scope";

ALTER TABLE "events" ALTER COLUMN "botId" DROP NOT NULL;

ALTER TABLE "memory_documents" DROP COLUMN "botId",
DROP COLUMN "scope",
ADD COLUMN "threadId" TEXT;

ALTER TABLE "pages" DROP COLUMN "botId",
DROP COLUMN "groupId",
ADD COLUMN "threadId" TEXT NOT NULL;

ALTER TABLE "routines" ADD COLUMN "webhookSecretId" TEXT,
ALTER COLUMN "threadId" SET NOT NULL;

ALTER TABLE "runs" DROP COLUMN "groupReplyOptional";
ALTER TABLE "space_memory_configs" DROP COLUMN "defaultMemoryScope";
ALTER TABLE "taught_skills" DROP COLUMN "botId";

ALTER TABLE "threads" DROP COLUMN "botId",
DROP COLUMN "groupId",
DROP COLUMN "lastReadSeq",
DROP COLUMN "unread",
ADD COLUMN "doodle" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "name" TEXT;

ALTER TABLE "user" ADD COLUMN "readAloud" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "thread_members" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadSeq" INTEGER NOT NULL DEFAULT -1,
    "unread" BOOLEAN NOT NULL DEFAULT false,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_members_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "thread_members_spaceId_userId_idx" ON "thread_members"("spaceId", "userId");
CREATE UNIQUE INDEX "thread_members_threadId_userId_key" ON "thread_members"("threadId", "userId");
CREATE INDEX "artifacts_threadId_idx" ON "artifacts"("threadId");
CREATE UNIQUE INDEX "bots_spaceId_key" ON "bots"("spaceId");
CREATE UNIQUE INDEX "browser_profiles_spaceId_userId_key" ON "browser_profiles"("spaceId", "userId");
CREATE UNIQUE INDEX "computer_execution_leases_computerId_key" ON "computer_execution_leases"("computerId");
CREATE UNIQUE INDEX "computers_spaceId_userId_key" ON "computers"("spaceId", "userId");
CREATE UNIQUE INDEX "memory_documents_threadId_path_key" ON "memory_documents"("threadId", "path");
CREATE UNIQUE INDEX "memory_documents_personal_path_key" ON "memory_documents"("spaceId", "userId", "path")
  WHERE "threadId" IS NULL;
CREATE INDEX "pages_threadId_idx" ON "pages"("threadId");
CREATE INDEX "routines_threadId_idx" ON "routines"("threadId");
CREATE INDEX "taught_skills_userId_status_idx" ON "taught_skills"("userId", "status");
CREATE UNIQUE INDEX "taught_skills_userId_recording_key" ON "taught_skills"("userId")
  WHERE "status" = 'recording';
CREATE UNIQUE INDEX "threads_id_spaceId_key" ON "threads"("id", "spaceId");

ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_threadId_spaceId_fkey" FOREIGN KEY ("threadId", "spaceId") REFERENCES "threads"("id", "spaceId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_spaceId_userId_fkey" FOREIGN KEY ("spaceId", "userId") REFERENCES "space_members"("spaceId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routines" ADD CONSTRAINT "routines_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory_documents" ADD CONSTRAINT "memory_documents_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pages" ADD CONSTRAINT "pages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "bots" ("id", "spaceId", "updatedAt")
SELECT 'c' || substr(md5('doodle:' || "id"), 1, 24), "id", CURRENT_TIMESTAMP FROM "spaces";

-- Chat content is visible only to the chat's people, in the workspace the request is for.
-- Definer rights read thread_members past its own policy; the search path is fixed so a
-- caller cannot shadow the table.
CREATE FUNCTION rakazo_is_thread_member(thread_id text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public."thread_members" m
      WHERE m."threadId" = thread_id
        AND m."userId" = NULLIF(current_setting('app.user_id', true), '')
        AND m."spaceId" = NULLIF(current_setting('app.space_id', true), '')
    )
  $$;

ALTER TABLE "thread_members" ENABLE ROW LEVEL SECURITY;
CREATE POLICY thread_members_tenant ON "thread_members"
  USING (rakazo_is_thread_member("threadId"));
CREATE POLICY thread_members_system ON "thread_members"
  USING ((SELECT app_rls_bypass()));

DROP POLICY threads_tenant ON "threads";
CREATE POLICY threads_tenant ON "threads"
  USING (rakazo_is_thread_member("id"));

DROP POLICY messages_tenant ON "messages";
CREATE POLICY messages_tenant ON "messages"
  USING (rakazo_is_thread_member("threadId"));

DROP POLICY events_tenant ON "events";
CREATE POLICY events_tenant ON "events"
  USING (rakazo_is_thread_member("threadId"));

DROP POLICY runs_tenant ON "runs";
CREATE POLICY runs_tenant ON "runs"
  USING (rakazo_is_thread_member("threadId"));

DROP POLICY tasks_tenant ON "tasks";
CREATE POLICY tasks_tenant ON "tasks"
  USING (rakazo_is_thread_member("threadId"));

DROP POLICY steering_messages_tenant ON "steering_messages";
CREATE POLICY steering_messages_tenant ON "steering_messages"
  USING (EXISTS (
    SELECT 1 FROM "messages" m
    WHERE m."id" = "steering_messages"."messageId" AND rakazo_is_thread_member(m."threadId")
  ));

DROP POLICY routines_tenant ON "routines";
CREATE POLICY routines_tenant ON "routines"
  USING (rakazo_is_thread_member("threadId"));

DROP POLICY artifacts_tenant ON "artifacts";
CREATE POLICY artifacts_tenant ON "artifacts"
  USING (rakazo_is_thread_member("threadId"));

DROP POLICY pages_tenant ON "pages";
CREATE POLICY pages_tenant ON "pages"
  USING (rakazo_is_thread_member("threadId"));

DROP POLICY page_versions_tenant ON "page_versions";
CREATE POLICY page_versions_tenant ON "page_versions"
  USING (EXISTS (
    SELECT 1 FROM "pages" p
    WHERE p."id" = "page_versions"."pageId" AND rakazo_is_thread_member(p."threadId")
  ));

-- A chat's memory is its members'; personal memory is its owner's alone.
DROP POLICY memory_documents_tenant ON "memory_documents";
CREATE POLICY memory_documents_tenant ON "memory_documents"
  USING (
    ("threadId" IS NULL AND "userId" = NULLIF(current_setting('app.user_id', true), ''))
    OR rakazo_is_thread_member("threadId")
  );

DROP POLICY memory_revisions_tenant ON "memory_revisions";
CREATE POLICY memory_revisions_tenant ON "memory_revisions"
  USING (EXISTS (
    SELECT 1 FROM "memory_documents" d
    WHERE d."id" = "memory_revisions"."documentId"
      AND (
        (d."threadId" IS NULL AND d."userId" = NULLIF(current_setting('app.user_id', true), ''))
        OR rakazo_is_thread_member(d."threadId")
      )
  ));

-- A recorded demo is the person's who recorded it.
DROP POLICY taught_skills_tenant ON "taught_skills";
CREATE POLICY taught_skills_tenant ON "taught_skills"
  USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));
