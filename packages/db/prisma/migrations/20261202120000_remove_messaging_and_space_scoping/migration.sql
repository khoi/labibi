DELETE FROM "threads" WHERE "externalConversationId" IS NOT NULL;
DROP TABLE "external_messages";
DROP TABLE "messaging_outbound";
DROP TABLE "messaging_channel_members";
DROP TABLE "messaging_channels";
DROP TABLE "messaging_link_codes";
DROP TABLE "messaging_identities";
DROP TABLE "messaging_install_sessions";
DROP TABLE "messaging_installations";
ALTER TABLE "threads" DROP COLUMN "externalConversationId";
ALTER TABLE "threads" ADD CONSTRAINT "threads_owner_chk" CHECK (num_nonnulls("botId", "groupId") = 1);
DROP TABLE "external_conversations";
ALTER TABLE "runs" DROP COLUMN "messagingMirroredAt";
ALTER TABLE "runs" DROP COLUMN "teamChatMirroredAt";
ALTER TABLE "bots" DROP COLUMN "teamChatAmbientEnabled";
ALTER TABLE "bots" DROP COLUMN "teamChatRules";
UPDATE "routines" SET "active" = false
  WHERE "messageProvider" IS NOT NULL AND "crons" = '{}' AND NOT "webhookEnabled"
    AND NOT "githubEnabled" AND "watch" IS NULL;
ALTER TABLE "routines" DROP COLUMN "messageProvider";
DELETE FROM "secrets" WHERE "id" IN (SELECT "secretId" FROM "agent_secrets");
DROP TABLE "agent_secrets";
DROP TABLE "bot_secrets";
UPDATE "mcp_servers" SET "enabled" = false
  WHERE NOT "allBots"
    AND NOT EXISTS (SELECT 1 FROM "bot_mcp_servers" a WHERE a."serverId" = "mcp_servers"."id");
DROP TABLE "bot_mcp_servers";
ALTER TABLE "mcp_servers" DROP COLUMN "allBots";
DROP TABLE "space_setting_overrides";
DROP TABLE "space_model_role_choices";
DROP TABLE "space_model_preferences";
DROP TABLE "space_voice_preferences";
DROP TABLE "action_approval_rules";
DROP TABLE "action_auto_review_preferences";
DELETE FROM "vault_credentials" v
  WHERE v."spaceId" IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM "vault_credentials" a
        WHERE a."userId" = v."userId" AND a."spaceId" IS NULL AND a."name" = v."name"
      )
      OR EXISTS (
        SELECT 1 FROM "vault_credentials" o
        WHERE o."userId" = v."userId" AND o."spaceId" IS NOT NULL AND o."name" = v."name"
          AND (o."updatedAt", o."id") > (v."updatedAt", v."id")
      )
    );
DROP POLICY vault_credentials_tenant ON "vault_credentials";
DROP INDEX "vault_credentials_userId_spaceId_name_key";
ALTER TABLE "vault_credentials" DROP COLUMN "spaceId";
CREATE UNIQUE INDEX "vault_credentials_userId_name_key" ON "vault_credentials"("userId", "name");
CREATE POLICY vault_credentials_tenant ON "vault_credentials"
  USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));
UPDATE "secrets" SET "spaceId" = NULL
  WHERE "spaceId" IS NOT NULL
    AND "id" IN (
      SELECT "secretId" FROM "mcp_servers" WHERE "secretId" IS NOT NULL
      UNION SELECT "secretId" FROM "capability_installs" WHERE "secretId" IS NOT NULL
    );
DROP POLICY agent_skills_available ON "agent_skills";
CREATE POLICY agent_skills_available ON "agent_skills"
  USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));
DROP POLICY mcp_servers_available ON "mcp_servers";
CREATE POLICY mcp_servers_available ON "mcp_servers"
  USING ("userId" = NULLIF(current_setting('app.user_id', true), ''));
DROP TABLE "agent_skill_spaces";
DROP TABLE "mcp_server_spaces";
DROP TABLE "capability_install_spaces";
ALTER TABLE "agent_skills" DROP COLUMN "allSpaces";
ALTER TABLE "mcp_servers" DROP COLUMN "allSpaces";
ALTER TABLE "capability_installs" DROP COLUMN "allSpaces";
