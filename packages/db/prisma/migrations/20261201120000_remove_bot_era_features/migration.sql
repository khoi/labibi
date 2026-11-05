DROP TABLE "agent_imports";
DROP TABLE "scratchpad_items";
ALTER TABLE "bots" DROP COLUMN "dailyCheckIns";
DROP TABLE "agent_connections";
ALTER TABLE "bots" DROP COLUMN "parentBotId";
ALTER TABLE "bots" DROP COLUMN "spawnKey";
ALTER TABLE "bots" DROP COLUMN "crossSpaceCommunication";
ALTER TABLE "bots" DROP COLUMN "fleetManagement";
ALTER TABLE "runs" DROP COLUMN "botOutcomeReturnedAt";
