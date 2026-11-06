import {
  applyCodexLiveCatalog,
  applyProviderLiveCatalog,
  CHATGPT_OAUTH_PROVIDER,
  CodexCatalogCache,
  codexLiveCatalogsForSpace,
  connectedModelSeesImages,
  connectionServesModel,
  createFaviconResolver,
  decisionModelCatalog,
  deploymentModelRole,
  findConnectedModelCredential,
  hiddenCatalogModel,
  kickModelCredentialRefresh,
  listAvailablePiCatalog,
  McpOAuthBroker,
  modelCredentialAuthKindsForSpace,
  offeredCatalog,
  providerCatalogCache,
  providerLiveCatalogsForSpace,
  savedCatalogSelections,
  scriptedCatalogEntry,
  validateConnectedModelChoice,
} from "@labradoodle/adapters";
import type {
  Actor,
  ModelCatalogEntry,
  ModelRole,
  ModelRoleChoice,
  ModelRoleSettings,
  ModelRoleView,
} from "@labradoodle/contracts";
import {
  appContract,
  canonicalPiProviderId,
  modelSupportsRole,
  OPENAI_COMPATIBLE_PROVIDER_ID,
} from "@labradoodle/contracts";
import { recordSecurityEvent, runAsTenant } from "@labradoodle/db";
import { implement, ORPCError } from "@orpc/server";
import { createAgentSkillsService } from "../agent-skills.js";
import { createMcpServers } from "../mcp-servers.js";
import { createModelConnector, prepareAllowedThinkingLevels } from "../model-credentials.js";
import type { RouterDeps } from "../router.js";
import { createRoutineAnnouncer } from "../routines.js";
import { procedureSecurityEvent } from "../security-audit.js";
import { createTaughtSkillsService } from "../taught-skills.js";
import { meDto } from "./shared.js";

/**
 * Runs an authenticated procedure with row-level security scoped to the actor's
 * Space. A streamed result is read after the procedure returns, so each step of
 * its iterator re-enters the same scope.
 */
export async function asTenant<T extends { output: unknown }>(
  actor: Actor,
  next: () => T | PromiseLike<T>,
): Promise<T> {
  const result = await runAsTenant(actor, next);
  const output = result.output;
  if (!output || typeof output !== "object" || !(Symbol.asyncIterator in output)) return result;
  const iterator = output as AsyncIterator<unknown> & AsyncIterable<unknown>;
  const scoped: AsyncIterableIterator<unknown> = {
    next: (...args) => runAsTenant(actor, () => iterator.next(...args)),
    return: (value) =>
      runAsTenant(actor, () => iterator.return?.(value) ?? { done: true as const, value }),
    throw: (error) =>
      runAsTenant(actor, () => (iterator.throw ? iterator.throw(error) : Promise.reject(error))),
    [Symbol.asyncIterator]() {
      return scoped;
    },
  };
  return { ...result, output: scoped };
}

export function createRouterContext(deps: RouterDeps) {
  const os = implement(appContract).$context<{
    actor: Actor | null;
    /** The signed-in session, so a push token ends with the session that registered it. */
    sessionId?: string;
    signal?: AbortSignal;
    /** Re-runs the request's auth so a long-lived stream notices sign-out and revocation. */
    stillAuthorized?: () => Promise<boolean>;
  }>();
  const onboardingDeps = { prisma: deps.prisma, events: deps.events, connectors: deps.connectors };
  const mcpOAuth = deps.mcpOAuth ?? new McpOAuthBroker(deps.prisma, deps.secrets);
  const {
    mcpAwaitsOAuth,
    probeMcpServer,
    beginMcpProbe,
    removeMcpServerInTransaction,
    prepareMcpServer,
    insertMcpServer,
    announceMcpServer,
  } = createMcpServers(deps, onboardingDeps, mcpOAuth);
  const announceRoutine = createRoutineAnnouncer(deps);
  const codexCatalog = deps.codexCatalog ?? new CodexCatalogCache();
  const { connectModelCredential } = createModelConnector(deps, codexCatalog);
  const favicons = deps.favicons ?? createFaviconResolver();
  const refreshExpiredCredential =
    deps.refreshExpiredModelCredential ??
    ((scope: { userId: string; spaceId: string }, secretId: string, provider: string) =>
      kickModelCredentialRefresh(deps.prisma, deps.secrets, scope, secretId, provider));
  const botModelValidation = (actor: Actor) => ({
    prisma: deps.prisma,
    secretStore: deps.secrets,
    codexCatalog,
    refreshExpiredCredential,
    defaultModel: async () => {
      const me = await meDto(deps, actor);
      return { provider: me.defaultProvider, model: me.defaultModel };
    },
  });
  // The scripted fixture only exists to drive the scripted runtime; a real runtime
  // cannot execute it, so it stays out of the user-facing catalog otherwise.
  const chatCatalog = async (actor: Actor) => {
    const catalog = await catalogForSpace(actor);
    return deps.env.agentRuntime === "scripted" ? [...catalog, scriptedCatalogEntry] : catalog;
  };
  const catalogForSpace = async (actor: Actor) => {
    const auth = await modelCredentialAuthKindsForSpace(deps.prisma, deps.secrets, actor);
    const available = listAvailablePiCatalog(auth.byProvider, auth.byModel);
    const [live, providerLive] = await Promise.all([
      codexLiveCatalogsForSpace(deps.prisma, deps.secrets, actor, auth, codexCatalog, {
        // An expired bearer yields no catalog this round; kick the runtime's
        // locked refresh so the next read can see the account's real list.
        onExpiredToken: (secretId) =>
          refreshExpiredCredential(actor, secretId, CHATGPT_OAUTH_PROVIDER),
      }),
      providerLiveCatalogsForSpace(
        deps.prisma,
        deps.secrets,
        actor,
        auth,
        deps.providerCatalog ?? providerCatalogCache,
      ),
    ]);
    const codexMerged = live.size > 0 ? applyCodexLiveCatalog(available, auth, live) : available;
    let selected = providerLive.size
      ? await savedCatalogSelections(deps.prisma, actor.userId)
      : undefined;
    const merged = applyProviderLiveCatalog(codexMerged, auth, providerLive, selected);
    // A connected provider's saved choice stays listed after new users stop being offered it.
    if (
      !selected &&
      merged.some(
        (entry) =>
          (auth.byProvider[entry.provider] || auth.byModel[entry.provider]) &&
          hiddenCatalogModel(entry),
      )
    )
      selected = await savedCatalogSelections(deps.prisma, actor.userId);
    return offeredCatalog(merged, selected);
  };

  // Shown where a member chose no model, so the list names what actually runs.
  const withDeploymentDefault = async (
    role: ModelRole,
    settings: ModelRoleSettings,
  ): Promise<ModelRoleView> => {
    const defaults =
      role === "main"
        ? {
            settings: await deps.prisma.deploymentSettings.findUnique({ where: { id: "default" } }),
            // Only a model the deployment can run stands in for the member's choice.
            deployment: deps.env.deploymentModelConfigured
              ? { provider: deps.env.defaultProvider, model: deps.env.defaultModel }
              : null,
          }
        : { env: process.env };
    return { ...settings, deploymentPrimary: deploymentModelRole(role, defaults).primary };
  };
  const modelRoleCatalog = async (actor: Actor, role: ModelRole): Promise<ModelCatalogEntry[]> => {
    const catalog = await chatCatalog(actor);
    const decisions = role === "approval" ? decisionModelCatalog() : [];
    return withServingConnections(
      actor,
      [...catalog, ...decisions].filter((entry) => modelSupportsRole(entry, role)),
    );
  };
  /**
   * The space's catalog merges what any of a provider's connections can run. Where two
   * accounts differ (one ChatGPT plan lists a model the other does not), each entry names
   * the connections that can run it.
   */
  const withServingConnections = async (
    actor: Actor,
    catalog: ModelCatalogEntry[],
  ): Promise<ModelCatalogEntry[]> => {
    const connections = await deps.prisma.userModelCredential.findMany({
      where: { userId: actor.userId },
      select: { id: true, provider: true, secretId: true },
    });
    const byProvider = new Map<string, typeof connections>();
    for (const connection of connections) {
      const provider = canonicalPiProviderId(connection.provider);
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), connection]);
    }
    return Promise.all(
      catalog.map(async (entry) => {
        const owners = byProvider.get(canonicalPiProviderId(entry.provider)) ?? [];
        // Decision models run through the provider's decisions API on any of its keys.
        if (owners.length < 2 || entry.placeholder || entry.protocol === "decisions") return entry;
        const serving: string[] = [];
        for (const owner of owners)
          if (
            await connectionServesModel(servingDeps, actor.userId, owner, entry.provider, entry.id)
          )
            serving.push(owner.id);
        return serving.length === owners.length ? entry : { ...entry, credentialIds: serving };
      }),
    );
  };
  const servingDeps = { prisma: deps.prisma, secretStore: deps.secrets, codexCatalog };
  /** The connection serving each choice, the one runs use. */
  const validateRoleChoices = async (
    actor: Actor,
    role: ModelRole,
    choices: ModelRoleChoice[],
  ): Promise<void> => {
    if (choices.length === 0) return;
    const catalog = await modelRoleCatalog(actor, role);
    for (const choice of choices) {
      const entry = catalog.find(
        (entry) =>
          entry.provider === canonicalPiProviderId(choice.provider) && entry.id === choice.modelId,
      );
      // A row pinned to a connection runs only there.
      const resolution = { credentialId: choice.credentialId };
      const credential = await findConnectedModelCredential(
        deps.prisma,
        deps.secrets,
        actor,
        choice.provider,
        choice.modelId,
        resolution,
      );
      if (!credential)
        throw new ORPCError("BAD_REQUEST", { message: "Connect that model provider first" });
      // Another account of the provider listing the model does not make it run on this one;
      // the catalog names the connections that can, as the picker shows.
      if (
        credential &&
        choice.credentialId &&
        entry?.credentialIds &&
        !entry.credentialIds.includes(choice.credentialId)
      )
        throw new ORPCError("BAD_REQUEST", {
          message: "That model is not available for this connection",
        });
      if (
        role === "computer" &&
        !(await connectedModelSeesImages(
          { prisma: deps.prisma, secretStore: deps.secrets },
          actor.userId,
          choice.provider,
          choice.modelId,
          credential,
          entry?.images,
        ))
      )
        throw new ORPCError("BAD_REQUEST", { message: "Choose a model that can see images" });
      if (choice.thinkingLevel) {
        const { allowed } = await prepareAllowedThinkingLevels(
          deps,
          actor,
          choice.provider,
          choice.modelId,
          resolution,
        );
        if (allowed && !allowed.includes(choice.thinkingLevel))
          throw new ORPCError("BAD_REQUEST", {
            message: `Thinking level must be one of: ${allowed.join(", ")}`,
          });
      }
      if (entry && !entry.placeholder && choice.provider !== OPENAI_COMPATIBLE_PROVIDER_ID)
        continue;
      const error = await validateConnectedModelChoice(
        deps.prisma,
        deps.secrets,
        actor,
        choice.provider,
        choice.modelId,
        resolution,
      );
      if (error || choice.provider !== OPENAI_COMPATIBLE_PROVIDER_ID)
        throw new ORPCError("BAD_REQUEST", {
          message: error ?? "That model is not available for this connection",
        });
    }
  };
  const taughtSkills = createTaughtSkillsService({
    prisma: deps.prisma,
    events: deps.events,
    jobs: deps.jobs,
    sandbox: deps.sandbox,
    home: deps.home,
    dataDir: deps.dataDir,
  });
  const agentSkills = createAgentSkillsService(deps.prisma);

  const authed = os
    .use(async ({ context, next }) => {
      const actor = context.actor;
      if (!actor) throw new ORPCError("UNAUTHORIZED");
      return asTenant(actor, () => next({ context: { ...context, actor } }));
    })
    .use(async ({ context, next, path }, input) => {
      const result = await next();
      const event = procedureSecurityEvent(path, input, context.actor);
      if (event) await recordSecurityEvent(event);
      return result;
    });

  return {
    deps,
    os,
    onboardingDeps,
    mcpOAuth,
    mcpAwaitsOAuth,
    probeMcpServer,
    beginMcpProbe,
    removeMcpServerInTransaction,
    prepareMcpServer,
    insertMcpServer,
    announceMcpServer,
    announceRoutine,
    codexCatalog,
    connectModelCredential,
    favicons,
    refreshExpiredCredential,
    botModelValidation,
    chatCatalog,
    withDeploymentDefault,
    modelRoleCatalog,
    validateRoleChoices,
    taughtSkills,
    agentSkills,
    authed,
  };
}

export type RouterContext = ReturnType<typeof createRouterContext>;
