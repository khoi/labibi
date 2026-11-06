import {
  defaultVaultItemTitle,
  forgetBotSecret,
  isSecretAlreadySaved,
  listVaultItems,
  newVaultItemName,
  normalizeSecretDestination,
  pageUrlOrigin,
  relabelVaultItem,
  revealBotSecret,
  storeBotSecret,
  validateBotModelChange,
} from "@labradoodle/adapters";
import type { Actor, BotSecretMetadata, VaultPutInput } from "@labradoodle/contracts";
import { BotSecretAuth } from "@labradoodle/contracts";
import {
  commitBotUpdate,
  getSpaceDoodle,
  InstructionConflictError,
  recordSecurityEvent,
  SpaceOwnerRequiredError,
} from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import { ORPCError } from "@orpc/server";
import { requireIdentityConfirmation } from "../identity-confirmation.js";
import type { RouterDeps } from "../router.js";
import type { RouterContext } from "./context.js";
import { isRecordNotFound } from "./shared.js";

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

/** A Doodle settings write by someone other than the workspace's owner. */
function mapDoodleWriteError(error: unknown, expectedSettings: boolean): unknown {
  if (error instanceof SpaceOwnerRequiredError) {
    return new ORPCError("FORBIDDEN", { message: error.message });
  }
  if (expectedSettings && isRecordNotFound(error)) {
    return new ORPCError("CONFLICT", {
      message: "Settings changed; review the current settings first.",
    });
  }
  if (error instanceof InstructionConflictError) {
    return new ORPCError("CONFLICT", { message: error.message });
  }
  return error;
}

export function doodleRoutes(ctx: RouterContext) {
  const { deps, botModelValidation, authed } = ctx;
  /** Open apps read Doodle again; the change is saved even if this signal is lost. */
  const announce = (spaceId: string) =>
    deps.events
      .publishDoodleChanged?.(spaceId)
      .catch((error) => getLogger().error("doodle change signal", error));
  return {
    doodle: {
      get: authed.doodle.get.handler(({ context }) => getSpaceDoodle(deps.prisma, context.actor)),
      update: authed.doodle.update.handler(async ({ context, input }) => {
        const existing = await getSpaceDoodle(deps.prisma, context.actor);
        if (!existing.canCustomize) {
          throw new ORPCError("FORBIDDEN", {
            message: "Only the workspace's owner can change this",
          });
        }
        if (input.modelProvider !== undefined || input.thinkingLevel !== undefined) {
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
        }
        await commitBotUpdate({
          prisma: deps.prisma,
          actor: context.actor,
          expectedInstructions: input.expectedInstructions,
          expectedSettings: input.expectedSettings,
          data: {
            instructions: input.instructions,
            voiceId: input.voiceId,
            ...(input.modelProvider !== undefined
              ? { modelProvider: input.modelProvider, modelId: input.modelId ?? null }
              : {}),
            ...(input.thinkingLevel !== undefined ? { thinkingLevel: input.thinkingLevel } : {}),
            ...(input.disabledBuiltinTools !== undefined
              ? { disabledBuiltinTools: input.disabledBuiltinTools }
              : {}),
          },
        }).catch((error) => {
          throw mapDoodleWriteError(error, input.expectedSettings !== undefined);
        });
        await announce(context.actor.spaceId);
        return getSpaceDoodle(deps.prisma, context.actor);
      }),
      restoreInstructions: authed.doodle.restoreInstructions.handler(async ({ context, input }) => {
        await commitBotUpdate({
          prisma: deps.prisma,
          actor: context.actor,
          data: {},
          expectedInstructions: input.expectedInstructions,
          instructionRestore: { versionId: input.versionId, undo: input.undo },
        }).catch((error) => {
          throw mapDoodleWriteError(error, false);
        });
        await announce(context.actor.spaceId);
        return getSpaceDoodle(deps.prisma, context.actor);
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
