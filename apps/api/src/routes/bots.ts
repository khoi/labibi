import { randomBytes } from "node:crypto";
import {
  archiveBot,
  checkpointAndStopComputer,
  defaultVaultItemTitle,
  forgetBotSecret,
  forgetPageShareSecrets,
  hasActiveComputerControl,
  isSecretAlreadySaved,
  listVaultItems,
  newVaultItemName,
  normalizeSecretDestination,
  pageUrlOrigin,
  relabelVaultItem,
  revealBotSecret,
  stopCancelledGroupRuns,
  storeBotSecret,
  toComputerRef,
  validateBotModelChange,
} from "@labradoodle/adapters";
import type { Actor, Bot, BotSecretMetadata, VaultPutInput } from "@labradoodle/contracts";
import { BotSecretAuth } from "@labradoodle/contracts";
import { ACTIVE_RUN_STATUSES } from "@labradoodle/core";
import {
  botProfileLabelsChanged,
  ComputerLimitError,
  commitBotUpdate,
  expireComputerExecutionLeases,
  InstructionConflictError,
  IsolationError,
  recordComputerRunEnd,
  recordSecurityEvent,
  SpaceDeletionInProgressError,
} from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import { ORPCError } from "@orpc/server";
import { changedBotSettings } from "../bot-setting-analytics.js";
import { requireIdentityConfirmation } from "../identity-confirmation.js";
import type { RouterDeps } from "../router.js";
import { loadMessagePage } from "../thread-message-pages.js";
import type { RouterContext } from "./context.js";
import { computerContext, isRecordNotFound, THREAD_MESSAGE_PAGE_SIZE } from "./shared.js";

/** Surface a Space deletion race as a retryable conflict instead of a generic failure. */
function mapSpaceLifecycleError(error: unknown): unknown {
  if (error instanceof SpaceDeletionInProgressError) {
    return new ORPCError("CONFLICT", { message: error.message });
  }
  if (error instanceof ComputerLimitError) {
    return new ORPCError("BAD_REQUEST", { message: error.message });
  }
  return error;
}

const BOT_SECRET_INPUT_ERRORS = [
  "Invalid credential destination",
  "Invalid credential length",
  "Credential cannot be used with this authentication method",
  "Remove the existing credential before changing its destination",
  "Credential limit reached",
  "Invalid card",
  "Invalid contact",
];

/** A credential the user typed that cannot be stored, as a bad request. Never echoes the value. */
export function mapBotSecretInputError(error: unknown): unknown {
  if (
    error instanceof Error &&
    BOT_SECRET_INPUT_ERRORS.some((prefix) => error.message.startsWith(prefix))
  ) {
    return new ORPCError("BAD_REQUEST", { message: error.message });
  }
  return error;
}

/** Map credential validation failures to a bad request without echoing the submitted value. */
function mapBotSecretStoreError(error: unknown): unknown {
  if (error instanceof ORPCError) return error;
  const mapped = mapBotSecretInputError(error);
  if (mapped !== error) return mapped;
  // Login decoding failures: a JSON parse message can quote the submitted value, so never forward it.
  if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
    return new ORPCError("BAD_REQUEST", {
      message: "A website login needs a label and a value for every field",
    });
  }
  return error;
}

/**
 * Save a vault item. One without a name is new and gets a free name from its title. One already
 * saved under the name keeps its value when none is given, so its title or note can change alone.
 */
async function saveVaultCredential(
  deps: RouterDeps,
  scope: Pick<Actor, "userId" | "spaceId">,
  input: Pick<VaultPutInput, "destination" | "value" | "title" | "note">,
) {
  const { name } = input.destination;
  if (input.value === undefined) {
    if (!name) throw new ORPCError("BAD_REQUEST", { message: "A new item needs its value" });
    try {
      const labels = { title: input.title, note: input.note };
      if (!(await relabelVaultItem(deps.prisma, scope, name, labels))) {
        throw new ORPCError("NOT_FOUND", { message: "Credential not found" });
      }
    } catch (error) {
      throw mapBotSecretStoreError(error);
    }
    return vaultItemDto(deps, scope, name);
  }
  const { value } = input;
  // A pasted page URL is saved under its site. One with a username or password is left
  // as typed, so the origin rule turns it down and the person can fix it.
  const site = pageUrlOrigin(input.destination.origin, { allowUserinfo: false, maxLength: 2048 });
  const store = (itemName: string, createOnly: boolean) =>
    storeBotSecret({
      prisma: deps.prisma,
      secretStore: deps.secrets,
      scope,
      destination: { ...input.destination, name: itemName, ...(site ? { origin: site } : {}) },
      plaintext: value,
      title: input.title,
      note: input.note,
      createOnly,
    });
  try {
    if (name) {
      await store(name, false);
      return vaultItemDto(deps, scope, name);
    }
    // A new item is named from its title. It is only ever created, so another save that took
    // the same name a moment earlier is never replaced; this one takes the next free name.
    const base = input.title || defaultVaultItemTitle(input.destination, value);
    for (let attempt = 0; ; attempt++) {
      const fresh = await newVaultItemName(deps.prisma, scope, base, input.destination.auth.type);
      try {
        await store(fresh, true);
        return vaultItemDto(deps, scope, fresh);
      } catch (error) {
        if (attempt >= 2 || !isSecretAlreadySaved(error)) throw error;
      }
    }
  } catch (error) {
    throw mapBotSecretStoreError(error);
  }
}

async function vaultItemDto(
  deps: RouterDeps,
  scope: Pick<Actor, "userId" | "spaceId">,
  name: string,
): Promise<BotSecretMetadata> {
  const [row] = await listVaultItems(deps.prisma, deps.secrets, scope, name);
  if (!row) throw new ORPCError("CONFLICT", { message: "Credential was not saved" });
  return botSecretMetadataDto(row);
}

function botSecretMetadataDto(
  row: Awaited<ReturnType<typeof listVaultItems>>[number],
): BotSecretMetadata {
  // Unreadable or no-longer-storable destinations become auth:null so the owner UI stays remove-only.
  const parsed = BotSecretAuth.safeParse(row.auth);
  let auth: BotSecretMetadata["auth"] = null;
  if (parsed.success) {
    try {
      normalizeSecretDestination({ name: row.name, origin: row.origin, auth: parsed.data });
      auth = parsed.data;
    } catch {
      auth = null;
    }
  }
  return {
    name: row.name,
    origin: row.origin,
    auth,
    title: row.title,
    note: row.note,
    ...(row.preview ? { preview: row.preview } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function botsRoutes(ctx: RouterContext) {
  const { deps, repos, botModelValidation, removeBot, groupRepos, authed } = ctx;
  return {
    bots: {
      list: authed.bots.list.handler(async ({ context }) => repos.listBots(context.actor)),
      get: authed.bots.get.handler(async ({ context, input }) => {
        const found = (await repos.listBots(context.actor)).find((bot) => bot.id === input.botId);
        if (!found) throw new IsolationError();
        return found;
      }),
      create: authed.bots.create.handler(async ({ context, input }) => {
        let bot: Bot;
        try {
          bot = await repos.createBot(context.actor, input);
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        }
        return bot;
      }),
      update: authed.bots.update.handler(async ({ context, input }) => {
        const existing = await repos.getBot(context.actor, input.botId);
        const modelChange = await validateBotModelChange(botModelValidation(context.actor), {
          userId: context.actor.userId,
          spaceId: context.actor.spaceId,
          provider:
            input.modelProvider !== undefined ? input.modelProvider : existing.modelProvider,
          model: input.modelId !== undefined ? input.modelId : existing.modelId,
          thinkingLevel: input.thinkingLevel,
          current: { provider: existing.modelProvider, model: existing.modelId },
        });
        if (!modelChange.ok) throw new ORPCError("BAD_REQUEST", { message: modelChange.error });
        const thinkingLevel = input.thinkingLevel;
        if (!existing.thread) throw new IsolationError();
        await commitBotUpdate({
          prisma: deps.prisma,
          notify: (threadId, seq) => deps.events.notify(threadId, seq),
          spaceId: context.actor.spaceId,
          threadId: existing.thread.id,
          botId: input.botId,
          emitBotUpdated: botProfileLabelsChanged(input) || input.expectedSettings !== undefined,
          expectedInstructions: input.expectedInstructions,
          expectedSettings: input.expectedSettings,
          data: {
            name: input.name,
            instructions: input.instructions,
            notifyOnFinish: input.notifyOnFinish,
            memoryScope: input.memoryScope,
            voiceId: input.voiceId,
            autoSpeak: input.autoSpeak,
            ...(input.modelProvider !== undefined
              ? { modelProvider: input.modelProvider, modelId: input.modelId ?? null }
              : {}),
            ...(input.thinkingLevel !== undefined ? { thinkingLevel } : {}),
            ...(input.disabledBuiltinTools !== undefined
              ? { disabledBuiltinTools: input.disabledBuiltinTools }
              : {}),
          },
        }).catch((error) => {
          if (input.expectedSettings && isRecordNotFound(error))
            throw new ORPCError("CONFLICT", {
              message: "Settings changed; review the current settings first.",
            });
          if (!(error instanceof InstructionConflictError)) throw error;
          throw new ORPCError("CONFLICT", { message: error.message });
        });
        for (const setting of changedBotSettings(existing, input)) {
          deps.analytics?.capture(context.actor.userId, { name: "bot_setting_changed", setting });
        }
        const bots = await repos.listBots(context.actor);
        const bot = bots.find((b) => b.id === input.botId);
        if (!bot) throw new IsolationError();
        return bot;
      }),
      restoreInstructions: authed.bots.restoreInstructions.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        if (!bot.thread) throw new IsolationError();
        try {
          await commitBotUpdate({
            prisma: deps.prisma,
            notify: (threadId, seq) => deps.events.notify(threadId, seq),
            spaceId: context.actor.spaceId,
            threadId: bot.thread.id,
            botId: bot.id,
            data: {},
            emitBotUpdated: true,
            expectedInstructions: input.expectedInstructions,
            instructionRestore: { versionId: input.versionId, undo: input.undo },
          });
        } catch (error) {
          if (!(error instanceof InstructionConflictError)) throw error;
          throw new ORPCError("CONFLICT", { message: error.message });
        }
        return (await repos.listBots(context.actor)).find((bot) => bot.id === input.botId)!;
      }),
      setComputer: authed.bots.setComputer.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        if (!bot.computer) throw new IsolationError();
        const currentMode = bot.computer.scope === "dedicated" ? "dedicated" : "team";
        if (currentMode === input.mode) {
          try {
            return await repos.setBotComputer(context.actor, bot.id, input.mode);
          } catch (error) {
            throw mapSpaceLifecycleError(error);
          }
        }
        const claimed = await deps.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM computers WHERE id = ${bot.computerId} FOR UPDATE`;
          return tx.bot.updateMany({
            where: { id: bot.id, computerSwitching: false, computer: { maintenanceId: null } },
            data: { computerSwitching: true },
          });
        });
        if (claimed.count !== 1) throw new ORPCError("CONFLICT");
        try {
          const active = await deps.prisma.run.findFirst({
            where: { botId: bot.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
            select: { id: true },
          });
          if (active) {
            throw new ORPCError("BAD_REQUEST", { message: "Stop the bot first" });
          }
          if (bot.computer.controlBotId === bot.id && hasActiveComputerControl(bot.computer)) {
            throw new ORPCError("BAD_REQUEST", { message: "Release the computer first" });
          }
          if (bot.computer.scope === "dedicated" && bot.computer.providerRef) {
            const ctx = computerContext(context.actor, bot.id, "computer.switch");
            const ref = toComputerRef(bot.computer);
            if (bot.computer.state === "running") {
              await checkpointAndStopComputer(deps, bot.computer, ref, ctx);
            }
            await expireComputerExecutionLeases(deps.prisma, {
              computerId: bot.computer.id,
              botId: bot.id,
            });
            await deps.prisma.computer.update({
              where: { id: bot.computer.id },
              data: {
                state: "stopped",
                controlHolder: "none",
                controlLeaseId: null,
                controlUserId: null,
                controlLeaseExpiresAt: null,
                controlBotId: null,
                controlRunId: null,
                executionRunId: null,
                executionBotId: null,
                executionLeaseExpiresAt: null,
              },
            });
            await recordComputerRunEnd(deps.prisma, bot.computer, "stopped");
          }
          const updated = await repos.setBotComputer(context.actor, bot.id, input.mode);
          deps.analytics?.capture(context.actor.userId, {
            name: "bot_setting_changed",
            setting: "computer",
          });
          return updated;
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        } finally {
          await deps.prisma.bot.updateMany({
            where: { id: bot.id },
            data: { computerSwitching: false },
          });
        }
      }),
      archive: authed.bots.archive.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId, { includeArchived: true });
        await archiveBot(
          {
            prisma: deps.prisma,
            sandbox: deps.sandbox,
            home: deps.home,
            jobs: deps.jobs,
            artifacts: deps.artifacts,
            dataDir: deps.dataDir,
          },
          bot,
          computerContext(context.actor, bot.id, "archive"),
        );
        return { ok: true as const };
      }),
      remove: authed.bots.remove.handler(async ({ context, input }) => {
        await removeBot(context.actor, input.botId, { deleteMemories: input.deleteMemories });
        return { ok: true as const };
      }),
      rotateWebhookSecret: authed.bots.rotateWebhookSecret.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        // Webhook runs act as the bot's creator, so only the creator can issue its secret.
        if (bot.userId !== context.actor.userId) throw new ORPCError("FORBIDDEN");
        const plaintext = randomBytes(32).toString("base64url");
        const stored = await deps.secrets.put(plaintext, {
          operationId: "bots.rotateWebhookSecret",
          traceId: "bots.rotateWebhookSecret",
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
          signal: context.signal ?? new AbortController().signal,
        });
        await deps.prisma.$transaction(async (tx) => {
          const previousSecretId = bot.webhookSecretId;
          await tx.secret.create({
            data: {
              id: stored.id,
              userId: context.actor.userId,
              spaceId: context.actor.spaceId,
              kind: "webhook",
              ciphertext: stored.ciphertext,
            },
          });
          await tx.bot.update({
            where: { id: bot.id },
            data: { webhookSecretId: stored.id },
          });
          if (previousSecretId) {
            await tx.secret.deleteMany({
              where: {
                id: previousSecretId,
                spaceId: context.actor.spaceId,
                userId: context.actor.userId,
                kind: "webhook",
              },
            });
          }
        });
        return {
          secret: plaintext,
          path: `/api/v1/bots/${bot.id}/webhook`,
          webhookConfigured: true as const,
        };
      }),
    },
    groups: {
      create: authed.groups.create.handler(async ({ context, input }) => {
        try {
          return await groupRepos.createGroup(context.actor, input);
        } catch (error) {
          throw mapSpaceLifecycleError(error);
        }
      }),
      list: authed.groups.list.handler(async ({ context }) => groupRepos.listGroups(context.actor)),
      get: authed.groups.get.handler(async ({ context, input }) => {
        const group = await groupRepos.getGroup(context.actor, input.groupId);
        return {
          ...groupRepos.mapGroup(group),
          messages: (
            await loadMessagePage(
              deps.prisma,
              group.thread!.id,
              undefined,
              THREAD_MESSAGE_PAGE_SIZE,
            )
          ).messages,
        };
      }),
      update: authed.groups.update.handler(async ({ context, input }) => {
        const updated = await groupRepos.updateGroup(context.actor, input);
        await stopCancelledGroupRuns(deps, context.actor, updated);
        return updated.group;
      }),
      archive: authed.groups.archive.handler(async ({ context, input }) => {
        const archived = await groupRepos.archiveGroup(context.actor, input.groupId);
        await stopCancelledGroupRuns(deps, context.actor, archived);
        return { ok: true as const };
      }),
      remove: authed.groups.remove.handler(async ({ context, input }) => {
        const removed = await groupRepos.removeGroup(context.actor, input.groupId);
        try {
          await stopCancelledGroupRuns(deps, context.actor, removed);
        } finally {
          // The group row is already gone, so a retry could no longer find these.
          const cleanup = await Promise.allSettled(
            removed.artifactStorageKeys.map((storageKey) =>
              deps.artifacts.remove(
                storageKey,
                computerContext(
                  context.actor,
                  removed.contextBotId,
                  `group-remove:${input.groupId}`,
                ),
              ),
            ),
          );
          for (const result of cleanup) {
            if (result.status === "rejected")
              getLogger().error("group artifact cleanup", result.reason);
          }
          await forgetPageShareSecrets(deps.secrets, removed.pageShareSecrets);
        }
        return { ok: true as const };
      }),
    },
    vault: {
      list: authed.vault.list.handler(async ({ context }) => {
        const rows = await listVaultItems(deps.prisma, deps.secrets, context.actor);
        return rows.map(botSecretMetadataDto);
      }),
      put: authed.vault.put.handler(({ context, input }) =>
        saveVaultCredential(deps, context.actor, input),
      ),
      reveal: authed.vault.reveal.handler(async ({ context, input }) => {
        await requireIdentityConfirmation(deps.auth, context);
        const revealed = await revealBotSecret({
          prisma: deps.prisma,
          secretStore: deps.secrets,
          scope: context.actor,
          name: input.name,
        });
        if (!revealed) throw new ORPCError("NOT_FOUND", { message: "Credential not found" });
        await recordSecurityEvent({
          type: "credential.revealed",
          userId: context.actor.userId,
          spaceId: context.actor.spaceId,
          metadata: {
            procedure: "vault.reveal",
            kind: "vault_credential",
            name: input.name,
          },
        });
        return revealed;
      }),
      remove: authed.vault.remove.handler(async ({ context, input }) => {
        await forgetBotSecret(deps.prisma, context.actor, input.name);
        return { ok: true as const };
      }),
    },
  };
}
