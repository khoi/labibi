import path from "node:path";
import { parseArgs } from "node:util";
import type { AgentHomeStore, ArtifactStore, SandboxProvider } from "@labradoodle/adapter-kit";
import { createAdapterContext } from "@labradoodle/adapter-kit";
import {
  contentKeyProviderFromEnv,
  createAgentHomeStore,
  createArtifactStore,
  createRunSandbox,
  createSecretStore,
  isSandboxGoneError,
  removeAgentHome,
  removeAgentHomeFolders,
  removeComputerWorkspaceDirectories,
  sandboxProviderOptionsFromEnv,
  toComputerRef,
  unwrapEnvFromKeyManager,
} from "@labradoodle/adapters";
import { browserProfilePathForScreen } from "@labradoodle/core/node/desktop-runtime";
import { loadRootEnv } from "@labradoodle/core/node/load-root-env";
import type { PrismaClient } from "@labradoodle/db";
import { createDb, runAsSystem } from "@labradoodle/db";
import { loadEnv } from "../env.js";

const USAGE = `Usage: retire-bot-era [--dry-run]
  Removes what the bot era left outside the database before the chats migration deletes its
  rows: sandboxes and saved homes of computers the migration drops, bot folders and browser
  profiles on the computers it keeps, stored chat files, and secrets held outside the
  database. Run it against the database the migration will change, before deploying it.
  Everything it removes stays removed, so it can be run again until it reports no failures.`;

const FOLDER_BATCH = 200;
const LIVE_STATES = new Set(["running", "booting"]);

type ComputerRow = {
  id: string;
  spaceId: string;
  userId: string;
  kind: string;
  providerRef: string | null;
  homeKey: string;
  state: string;
};
type Deps = {
  prisma: PrismaClient;
  sandbox: SandboxProvider;
  home: AgentHomeStore;
  artifacts: ArtifactStore;
  dataDir: string;
};
type Tally = { done: number; failed: number };

loadRootEnv();
await unwrapEnvFromKeyManager();

const dryRun = parseDryRun();
const env = loadEnv();
const { prisma, pool } = createDb(env.databaseUrl, {
  applicationName: "labradoodle-retire-bot-era",
  keyProvider: contentKeyProviderFromEnv(),
});
const write = (line: string) => process.stdout.write(`${line}\n`);

try {
  const secrets = createSecretStore(env.encryptionKey);
  const deps: Deps = {
    prisma,
    sandbox: await createRunSandbox(env.sandboxProvider, {
      ...sandboxProviderOptionsFromEnv(),
      supervisorUrl: env.sandboxSupervisorUrl,
      supervisorToken: env.sandboxSupervisorToken,
      e2bApiKey: env.e2bApiKey,
      novitaApiKey: env.novitaApiKey,
      sandboxTemplate: env.sandboxTemplate,
      daytonaApiKey: env.daytonaApiKey,
      daytonaApiUrl: env.daytonaApiUrl,
      daytonaTarget: env.daytonaTarget,
      boatApiKey: env.boatApiKey,
      boatApiUrl: env.boatApiUrl,
      dataDir: env.dataDir,
      prisma,
      secrets,
    }),
    home: createAgentHomeStore(env.dataDir, prisma),
    artifacts: createArtifactStore(env.dataDir, prisma),
    dataDir: env.dataDir,
  };
  const dropped = await read<ComputerRow>(
    `SELECT "id", "spaceId", "userId", "kind", "providerRef", "homeKey", "state" FROM "computers"
     WHERE "scopeKey" IS DISTINCT FROM ('team:' || "spaceId" || ':' || "userId")`,
  );
  const kept = await read<ComputerRow>(
    `SELECT "id", "spaceId", "userId", "kind", "providerRef", "homeKey", "state" FROM "computers"
     WHERE "scopeKey" = ('team:' || "spaceId" || ':' || "userId")`,
  );
  const botIds = await read<{ spaceId: string; id: string }>(
    `SELECT "spaceId", "id" FROM "bots" UNION SELECT "spaceId", "id" FROM "bot_deletions"`,
  );
  const agentHomes = await read<{ spaceId: string; userId: string; botId: string }>(
    `SELECT "spaceId", "userId", "botId" FROM "agent_homes"`,
  );
  const files = await read<{ spaceId: string; userId: string; storageKey: string }>(
    `SELECT DISTINCT "spaceId", "userId", "storageKey" FROM "artifacts"`,
  );
  const heldSecrets = await read<{ id: string; ciphertext: string }>(
    `SELECT "id", "ciphertext" FROM "secrets" WHERE "id" IN (
       SELECT "webhookSecretId" FROM "bots" WHERE "webhookSecretId" IS NOT NULL
       UNION SELECT "shareSecretId" FROM "pages" WHERE "shareSecretId" IS NOT NULL
       UNION SELECT "secretId" FROM "browser_profiles" WHERE "secretId" IS NOT NULL
     )`,
  );

  if (dryRun) {
    write(`computers to remove: ${dropped.length}`);
    write(`computers to clear of bot folders: ${kept.length}`);
    write(`bot homes to remove: ${agentHomes.length}`);
    write(`stored files to remove: ${files.length}`);
    write(`secrets to forget: ${heldSecrets.length}`);
  } else {
    const botsBySpace = new Map<string, string[]>();
    for (const row of botIds)
      botsBySpace.set(row.spaceId, [...(botsBySpace.get(row.spaceId) ?? []), row.id]);
    report("computers removed", await each(dropped, (computer) => removeComputer(deps, computer)));
    report(
      "computers cleared of bot folders",
      await each(kept, (computer) =>
        clearBotFolders(deps, computer, botsBySpace.get(computer.spaceId) ?? []),
      ),
    );
    report(
      "bot homes removed",
      await each(agentHomes, (row) => removeAgentHome(deps.home, row.botId, deps.dataDir)),
    );
    report(
      "stored files removed",
      await each(files, (file) =>
        deps.artifacts.remove(
          file.storageKey,
          createAdapterContext(file, "retire-bot-era", "retire-bot-era"),
        ),
      ),
    );
    report(
      "secrets forgotten",
      await each(heldSecrets, (secret) =>
        secrets.delete(secret.ciphertext, {
          recordId: secret.id,
          signal: AbortSignal.timeout(10_000),
        }),
      ),
    );
  }
} catch (error) {
  process.stderr.write(
    `retire-bot-era failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => undefined);
  await pool.end().catch(() => undefined);
}

function parseDryRun(): boolean {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { "dry-run": { type: "boolean" } },
    });
    if (positionals.length === 0) return values["dry-run"] === true;
  } catch {}
  process.stderr.write(`${USAGE}\n`);
  process.exit(2);
}

function read<T>(sql: string): Promise<T[]> {
  return runAsSystem("retire bot era", () => prisma.$queryRawUnsafe<T[]>(sql));
}

async function each<T>(rows: readonly T[], work: (row: T) => Promise<unknown>): Promise<Tally> {
  const tally: Tally = { done: 0, failed: 0 };
  for (const row of rows) {
    try {
      await runAsSystem("retire bot era", () => work(row));
      tally.done += 1;
    } catch (error) {
      tally.failed += 1;
      write(`  failed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return tally;
}

function report(label: string, tally: Tally) {
  write(`${label}: ${tally.done}${tally.failed ? `, ${tally.failed} failed` : ""}`);
  if (tally.failed) process.exitCode = 1;
}

async function removeComputer(deps: Deps, computer: ComputerRow) {
  if (computer.providerRef && computer.kind !== "desktop") await retireSandbox(deps, computer);
  await removeAgentHome(deps.home, computer.homeKey, deps.dataDir);
}

async function retireSandbox(deps: Deps, computer: ComputerRow) {
  await deps.sandbox.destroy(toComputerRef(computer), contextFor(computer)).catch((error) => {
    if (!isSandboxGoneError(error)) throw error;
  });
  await deps.prisma.$executeRaw`
    UPDATE "computers" SET "providerRef" = NULL, "state" = 'stopped', "screenUrl" = NULL
    WHERE "id" = ${computer.id}`;
}

async function clearBotFolders(deps: Deps, computer: ComputerRow, botIds: readonly string[]) {
  const folders = botIds.filter((id) => /^[A-Za-z0-9_-]+$/.test(id));
  const profiles = botIds
    .map((id) => path.posix.basename(browserProfilePathForScreen(id)))
    .filter((name) => /^chromium-bot-[0-9a-f]{32}$/.test(name));
  const live = computer.providerRef && computer.kind !== "desktop" ? toComputerRef(computer) : null;
  if (live && !LIVE_STATES.has(computer.state) && (await deps.sandbox.keepsHome?.(live)))
    await retireSandbox(deps, computer);
  for (const [parent, names] of [
    ["bots", folders],
    [".browser-profiles", profiles],
  ] as const) {
    for (let start = 0; start < names.length; start += FOLDER_BATCH) {
      const batch = names.slice(start, start + FOLDER_BATCH);
      if (live && LIVE_STATES.has(computer.state))
        await removeComputerWorkspaceDirectories(
          deps.sandbox,
          live,
          parent,
          batch,
          contextFor(computer),
        );
      await removeAgentHomeFolders(deps.home, computer.homeKey, parent, batch, deps.dataDir);
    }
  }
}

function contextFor(computer: ComputerRow) {
  return createAdapterContext(computer, "retire-bot-era", `retire-bot-era:${computer.id}`);
}
