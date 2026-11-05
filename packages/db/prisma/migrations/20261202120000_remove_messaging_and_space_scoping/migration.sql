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
