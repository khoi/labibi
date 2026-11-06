import type { ManagedConnectorProvider } from "@labradoodle/adapter-kit";
import {
  ConnectorAuthUnavailableError,
  routineWakeupJob,
  SecretStoreUnavailableError,
} from "@labradoodle/adapter-kit";
import type { McpOAuthSummary } from "@labradoodle/adapters";
import * as adapters from "@labradoodle/adapters";
import {
  CodexCatalogCache,
  EncryptedSecretStore,
  IntegrationProviderSettings,
  listPiCatalog,
  McpOAuthClientRequiredError,
  ModelSignInError,
  modelCredentialDto,
  parseModelSecret,
  serializeModelSecret,
} from "@labradoodle/adapters";
import type { Actor } from "@labradoodle/contracts";
import {
  CONNECTOR_AUTH_UNAVAILABLE,
  MCP_OAUTH_CLIENT_REQUIRED,
  MODEL_KEY_FORMAT_ERROR,
  REPLY_QUOTE_MAX_LENGTH,
} from "@labradoodle/contracts";
import type { PrismaClient } from "@labradoodle/db";
import { configureProviderTransactionPool, runProviderTransaction } from "@labradoodle/db";
import { createLogger, createTestSink, installLogger } from "@labradoodle/logging";
import type { InferRouterInitialContext } from "@orpc/server";
import { createRouterClient } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mainRole, withModelRoles } from "../../../packages/adapters/src/testing/model-roles.js";
import type { RouterDeps } from "./router.js";
import { createRouter as createRouterWith } from "./router.js";
import { providerScopeKey } from "./routes/connections.js";

const withRoleDeps = (deps: RouterDeps) => {
  withModelRoles(deps.prisma);
  return deps;
};
const createRouter = (deps: RouterDeps) => createRouterWith(withRoleDeps(deps));

type RouterHandler = RPCHandler<InferRouterInitialContext<ReturnType<typeof createRouter>>>;

// Every path these tests call is routed, so a missing response is a broken test.
async function handle(handler: RouterHandler, ...args: Parameters<RouterHandler["handle"]>) {
  const { response } = await handler.handle(...args);
  if (!response) throw new Error("no response");
  return response;
}

describe("account preferences", () => {
  function preferencesDeps(avatarStyle: string, timezone: string | null = null) {
    const update = vi.fn().mockResolvedValue({});
    const user = {
      email: "user@labradoodle.test",
      name: "Test User",
      avatarStyle,
      timezone,
      readAloud: false,
      secrets: [],
    };
    const updateMany = vi.fn(
      async ({ where, data }: { where: { timezone: null }; data: { timezone: string } }) => {
        if (user.timezone !== where.timezone) return { count: 0 };
        Object.assign(user, data);
        return { count: 1 };
      },
    );
    const botFindMany = vi.fn().mockResolvedValue([]);
    const routines: Record<string, unknown>[] = [];
    const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
      Object.entries(where).every(([key, value]) =>
        value && typeof value === "object" && "in" in value
          ? (value.in as unknown[]).includes(row[key])
          : row[key] === value,
      );
    const prisma = {
      user: {
        update,
        updateMany,
        findUnique: vi.fn(async () => ({ timezone: user.timezone })),
        findUniqueOrThrow: vi.fn().mockResolvedValue(user),
      },
      bot: { findMany: botFindMany },
      routine: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          routines.filter((row) => matches(row, where)),
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            let count = 0;
            for (const [index, row] of routines.entries()) {
              if (!matches(row, where)) continue;
              routines[index] = { ...row, ...data };
              count += 1;
            }
            return { count };
          },
        ),
      },
      $transaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) => run(prisma)),
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join("?");
        if (sql.includes("FOR SHARE")) return [{ timezone: user.timezone }];
        if (sql.includes('"routines"')) {
          return routines
            .filter((row) => matches(row, { userId: values[0], timezone: values[1] }))
            .map((row) => ({ id: row.id }));
        }
        return [];
      }),
      userModelPreference: { findFirst: vi.fn().mockResolvedValue(null) },
      deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      jobs: { enqueue: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const actor = {
      spaceId: "workspace-1",
      userId: "user-1",
      email: "user@labradoodle.test",
      isDeploymentOwner: true,
    } satisfies Actor;
    return {
      update,
      updateMany,
      routines,
      deps,
      actor,
      handler: new RPCHandler(createRouter(deps)),
    };
  }

  it("records only validated screens under the authenticated actor", async () => {
    const { deps, actor } = preferencesDeps("robot");
    const capture = vi.fn();
    deps.analytics = { capture, flush: async () => undefined };
    const client = createRouterClient(createRouter(deps), { context: { actor } as never });
    await expect(client.analytics.screen({ screen: "chat", surface: "desktop" })).resolves.toEqual({
      ok: true,
    });
    expect(capture).toHaveBeenCalledWith(actor.userId, {
      name: "screen_viewed",
      screen: "chat",
      surface: "desktop",
    });
    await expect(
      client.analytics.screen({
        screen: "chat",
        surface: "web",
        email: "private@example.test",
      } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const anonymous = createRouterClient(createRouter(deps), { context: {} as never });
    await expect(
      anonymous.analytics.screen({ screen: "chat", surface: "web" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("reports model credential store outages as service unavailable", async () => {
    const { deps, actor } = preferencesDeps("robot");
    Object.assign(deps.prisma, {
      userModelCredential: {
        findMany: vi.fn(async () => [{ secretId: "secret", userPreferences: [] }]),
      },
      secret: { findMany: vi.fn(async () => [{ id: "secret", ciphertext: "ref" }]) },
    });
    deps.secrets = {
      load: vi.fn(async () => {
        throw new SecretStoreUnavailableError();
      }),
    } as never;
    const client = createRouterClient(createRouter(deps), { context: { actor } as never });
    await expect(client.models.credentials()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      status: 503,
    });
  });

  it("marks the connection running the main role as the default", async () => {
    const { deps, actor } = preferencesDeps("robot");
    const connection = (id: string, modelId: string) => ({
      id,
      userId: actor.userId,
      provider: "openrouter",
      label: id,
      secretId: `secret-${id}`,
      supportsImages: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      userPreferences: [{ credentialId: id, modelId, thinkingLevel: null, updatedAt: new Date(0) }],
    });
    const rows = [connection("first", "own-first"), connection("second", "own-second")];
    Object.assign(deps.prisma, {
      userModelCredential: {
        findMany: vi.fn(async () => rows),
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
          rows.find((row) => row.id === where.id),
        ),
      },
      secret: { findMany: vi.fn(async () => []) },
    });
    // preferencesDeps already gave these deps their role table.
    const client = createRouterClient(createRouterWith(deps), { context: { actor } as never });
    await (
      deps.prisma.userModelRoleChoice as unknown as {
        createMany: (args: { data: unknown[] }) => Promise<unknown>;
      }
    ).createMany({
      data: [
        {
          userId: actor.userId,
          spaceId: actor.spaceId,
          role: "main",
          position: 0,
          provider: "openrouter",
          modelId: "main-model",
          thinkingLevel: "high",
          credentialId: "second",
        },
      ],
    });

    const credentials = await client.models.credentials();

    expect(credentials.map(({ id, isDefault, modelId }) => ({ id, isDefault, modelId }))).toEqual([
      { id: "first", isDefault: false, modelId: "own-first" },
      { id: "second", isDefault: true, modelId: "main-model" },
    ]);
  });

  it("keeps a compatible connection's own model enabled while it shows the main model", async () => {
    const { deps, actor } = preferencesDeps("robot");
    const row = {
      id: "compatible",
      userId: actor.userId,
      provider: "openai-compatible",
      label: "Local",
      secretId: "secret-compatible",
      supportsImages: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      // Its own model is outside the stored list, which enables only the main model.
      userPreferences: [
        {
          credentialId: "compatible",
          modelId: "own-a",
          thinkingLevel: null,
          updatedAt: new Date(0),
        },
      ],
    };
    Object.assign(deps.prisma, {
      userModelCredential: {
        findMany: vi.fn(async () => [row]),
        findFirst: vi.fn(async () => row),
      },
      secret: {
        findMany: vi.fn(async () => [{ id: row.secretId, ciphertext: "fake-ciphertext" }]),
      },
    });
    deps.secrets = {
      load: vi.fn(async () =>
        serializeModelSecret({
          kind: "openai_compatible",
          baseUrl: "http://127.0.0.1:11434/v1",
          enabledModelIds: ["main-b"],
        }),
      ),
    } as never;
    // preferencesDeps already gave these deps their role table.
    const client = createRouterClient(createRouterWith(deps), { context: { actor } as never });
    await (
      deps.prisma.userModelRoleChoice as unknown as {
        createMany: (args: { data: unknown[] }) => Promise<unknown>;
      }
    ).createMany({
      data: [
        {
          userId: actor.userId,
          spaceId: actor.spaceId,
          role: "main",
          position: 0,
          provider: "openai-compatible",
          modelId: "main-b",
          thinkingLevel: null,
          credentialId: row.id,
        },
      ],
    });

    const [credential] = await client.models.credentials();

    expect(credential).toMatchObject({ isDefault: true, modelId: "main-b" });
    expect(credential?.enabledModelIds).toEqual(["main-b", "own-a"]);
  });

  it("keeps an unconfigured catalog offline unless explicitly requested", async () => {
    const { actor, deps } = preferencesDeps("robot");
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );
    deps.remoteConnectors = { fetch } as RouterDeps["remoteConnectors"];
    const handler = new RPCHandler(createRouter(deps));
    const request = async (usePublicCatalog?: boolean) =>
      handle(
        handler,
        new Request("http://127.0.0.1/rpc/capabilities/catalogSearch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { query: "notion", usePublicCatalog } }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
    const response = await request();
    await expect(response.json()).resolves.toEqual({ json: { enabled: false, results: [] } });
    expect(fetch).not.toHaveBeenCalled();
    await request(true);
    expect(fetch).toHaveBeenCalled();
  });

  it("accepts an avatar style from an older app without storing it", async () => {
    const { update, actor, handler } = preferencesDeps("organic");

    const response = await handle(
      handler,
      new Request("http://127.0.0.1/rpc/preferences/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { avatarStyle: "robot" } }),
      }),
      { prefix: "/rpc", context: { actor } },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: {} });
    await expect(response.json()).resolves.toEqual({
      json: expect.objectContaining({ avatarStyle: "organic" }),
    });
  });

  it("rejects avatar styles outside robot|organic", async () => {
    const { update, actor, handler } = preferencesDeps("robot");

    const response = await handle(
      handler,
      new Request("http://127.0.0.1/rpc/preferences/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { avatarStyle: "dicebear" } }),
      }),
      { prefix: "/rpc", context: { actor } },
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(update).not.toHaveBeenCalled();
  });

  async function updatePreferences(
    { handler, actor }: ReturnType<typeof preferencesDeps>,
    json: unknown,
  ) {
    const response = await handle(
      handler,
      new Request("http://127.0.0.1/rpc/preferences/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    return response;
  }

  it("persists an IANA timezone without touching the avatar style", async () => {
    const setup = preferencesDeps("organic");

    const response = await updatePreferences(setup, { timezone: "Pacific/Auckland" });

    expect(response.status).toBe(200);
    expect(setup.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { timezone: "Pacific/Auckland" },
    });
  });

  it("saves the timezone and the language preference in one write", async () => {
    const setup = preferencesDeps("organic", "Africa/Cairo");

    const response = await updatePreferences(setup, {
      timezone: "Europe/London",
      locale: "pt-BR",
    });

    expect(response.status).toBe(200);
    expect(setup.update).toHaveBeenCalledTimes(1);
    expect(setup.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { timezone: "Europe/London", locale: "pt-BR" },
    });
  });

  it("moves routines that took the account zone to the new one", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-04T12:00:00.000Z") });
    try {
      const setup = preferencesDeps("organic", "Africa/Cairo");
      setup.routines.push(
        {
          id: "routine-1",
          userId: "user-1",
          crons: ["0 9 * * 1"],
          timezone: "Africa/Cairo",
          active: true,
          watch: null,
          nextRunAt: new Date("2026-11-09T07:00:00.000Z"),
        },
        {
          id: "routine-2",
          userId: "user-1",
          crons: ["0 9 * * 1"],
          timezone: "Asia/Tokyo",
          active: true,
          watch: null,
          nextRunAt: new Date("2026-11-09T00:00:00.000Z"),
        },
      );

      const response = await updatePreferences(setup, { timezone: "Europe/London" });

      expect(response.status).toBe(200);
      // The routine that took the account zone keeps Monday 09:00 in London; the pinned one stays.
      expect(setup.routines[0]).toMatchObject({
        timezone: "Europe/London",
        nextRunAt: new Date("2026-11-09T09:00:00.000Z"),
      });
      expect(setup.routines[1]).toMatchObject({ timezone: "Asia/Tokyo" });
      expect(setup.deps.jobs.enqueue).toHaveBeenCalledWith(
        routineWakeupJob("routine-1", new Date("2026-11-09T09:00:00.000Z")),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves the app language emails are written in", async () => {
    const setup = preferencesDeps("organic");

    const response = await updatePreferences(setup, { locale: "pt-BR" });

    expect(response.status).toBe(200);
    expect(setup.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { locale: "pt-BR" },
    });
  });

  it.each([null, "Europe/London"])(
    "adopts the browser timezone only while the saved value is null (%s)",
    async (timezone) => {
      const setup = preferencesDeps("organic", timezone);
      const client = createRouterClient(createRouter(setup.deps), {
        context: { actor: setup.actor } as never,
      });
      const me = await client.preferences.adoptTimezone({ timezone: "Pacific/Auckland" });
      expect(setup.updateMany).toHaveBeenCalledWith({
        where: { id: "user-1", timezone: null },
        data: { timezone: "Pacific/Auckland" },
      });
      expect(me.timezone).toBe(timezone ?? "Pacific/Auckland");
      expect(setup.update).not.toHaveBeenCalled();
    },
  );

  it.each([{ timezone: "Mars/Olympus_Mons" }, { timezone: "" }, {}])(
    "rejects an unknown timezone or an empty update: %j",
    async (json) => {
      const setup = preferencesDeps("robot");

      const response = await updatePreferences(setup, json);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(setup.update).not.toHaveBeenCalled();
    },
  );

  it("rejects adopting an unknown timezone", async () => {
    const setup = preferencesDeps("robot");
    const response = await handle(
      setup.handler,
      new Request("http://127.0.0.1/rpc/preferences/adoptTimezone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { timezone: "Mars/Olympus_Mons" } }),
      }),
      { prefix: "/rpc", context: { actor: setup.actor } },
    );

    expect(response?.status).toBeGreaterThanOrEqual(400);
    expect(setup.updateMany).not.toHaveBeenCalled();
  });

  it.each(["robot", "organic", "custom-cdn"])(
    "always reports the organic style, whatever is stored (%s)",
    async (style) => {
      const { actor, handler } = preferencesDeps(style);

      const response = await handle(
        handler,
        new Request("http://127.0.0.1/rpc/me", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: null }),
        }),
        { prefix: "/rpc", context: { actor } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        json: expect.objectContaining({ avatarStyle: "organic" }),
      });
    },
  );
});

describe("billing", () => {
  const surveyCreatedAt = new Date("2026-10-23T12:00:00Z");
  const upsertSignupSurvey = vi.fn().mockResolvedValue({ createdAt: surveyCreatedAt });

  function billingDeps(
    isDeploymentOwner: boolean,
    billing?: RouterDeps["billing"],
    signupSurvey: { userId: string } | null = null,
    analytics?: RouterDeps["analytics"],
  ) {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          email: "user@labradoodle.test",
          name: "Test User",
          avatarStyle: "robot",
          signupSurvey,
          secrets: [],
        }),
      },
      signupSurvey: { upsert: upsertSignupSurvey },
      userModelPreference: { findFirst: vi.fn().mockResolvedValue(null) },
      deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      billing,
      analytics,
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const actor = {
      spaceId: "workspace-1",
      userId: "user-1",
      email: "user@labradoodle.test",
      isDeploymentOwner,
    } satisfies Actor;
    return createRouterClient(createRouter(deps), { context: { actor } });
  }

  it("sends only the fixed survey choices to analytics", async () => {
    const capture = vi.fn();
    const client = billingDeps(false, undefined, null, { capture, flush: async () => undefined });
    await client.onboarding.signupSurvey({
      use: "work",
      teamSize: "2-10",
      reason: "Private plans",
      source: "A friend",
    });
    await client.onboarding.signupSurvey({});
    expect(capture.mock.calls.map(([userId, event]) => [userId, event])).toEqual([
      ["user-1", { name: "signup_survey_answered", skipped: false, use: "work", teamSize: "2-10" }],
      ["user-1", { name: "signup_survey_answered", skipped: true }],
    ]);
    expect(capture.mock.calls.map(([, , identity]) => identity)).toEqual([
      { id: "user-1", at: surveyCreatedAt },
      { id: "user-1", at: surveyCreatedAt },
    ]);
  });

  it("records a blank survey as skipped", async () => {
    await billingDeps(false).onboarding.signupSurvey({});
    expect(upsertSignupSurvey).toHaveBeenLastCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1", reason: null, use: null, teamSize: null, source: null },
      update: { reason: null, use: null, teamSize: null, source: null },
    });
  });

  it("keeps team size only for work or both", async () => {
    const client = billingDeps(false);
    await client.onboarding.signupSurvey({
      reason: "  Run my inbox  ",
      use: "personal",
      teamSize: "11-50",
      source: "",
    });
    expect(upsertSignupSurvey).toHaveBeenLastCalledWith({
      where: { userId: "user-1" },
      create: {
        userId: "user-1",
        reason: "Run my inbox",
        use: "personal",
        teamSize: null,
        source: null,
      },
      update: { reason: "Run my inbox", use: "personal", teamSize: null, source: null },
    });

    await client.onboarding.signupSurvey({ use: "work", teamSize: "11-50" });
    expect(upsertSignupSurvey).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: { reason: null, use: "work", teamSize: "11-50", source: null },
      }),
    );

    await client.onboarding.signupSurvey({ use: "both", teamSize: "2-10" });
    expect(upsertSignupSurvey).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: { reason: null, use: "both", teamSize: "2-10", source: null },
      }),
    );
  });
});

describe("model setup gate", () => {
  function modelGateDeps(options: {
    agentRuntime: string;
    maxUploadSizeBytes?: number;
    maxAttachmentsPerMessage?: number;
    deploymentModelConfigured?: boolean;
    deploymentModelHostCredentials?: boolean;
    deploymentModelCredentialCipher?: string;
  }) {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          email: "user@labradoodle.test",
          name: "Test User",
          avatarStyle: "robot",
          secrets: [],
        }),
      },
      // A bot that follows the main model.
      bot: {
        findFirst: vi.fn().mockResolvedValue({ id: "bot-1", thread: { id: "thread-1" } }),
        findMany: vi
          .fn()
          .mockResolvedValue([{ modelProvider: null, modelId: null, thinkingLevel: null }]),
      },
      userModelPreference: { findFirst: vi.fn().mockResolvedValue(null) },
      deploymentSettings: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            options.deploymentModelCredentialCipher
              ? { deploymentModelCredentialCipher: options.deploymentModelCredentialCipher }
              : null,
          ),
      },
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      env: {
        agentRuntime: options.agentRuntime,
        maxUploadSizeBytes: options.maxUploadSizeBytes,
        maxAttachmentsPerMessage: options.maxAttachmentsPerMessage,
        defaultProvider: "openrouter",
        defaultModel: "test-model",
        deploymentModelConfigured: options.deploymentModelConfigured,
        deploymentModelHostCredentials: options.deploymentModelHostCredentials,
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const actor = {
      spaceId: "workspace-1",
      userId: "user-1",
      email: "user@labradoodle.test",
      isDeploymentOwner: true,
    } satisfies Actor;
    return { actor, handler: new RPCHandler(createRouter(deps)) };
  }

  async function call(handler: RouterHandler, actor: Actor, path: string, body: unknown) {
    const response = await handle(
      handler,
      new Request(`http://127.0.0.1/rpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: body }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    return response;
  }

  it("rejects an over-length reply quote", async () => {
    const { actor, handler } = modelGateDeps({ agentRuntime: "scripted" });

    const response = await call(handler, actor, "threads/send", {
      botId: "bot-1",
      text: "hello",
      replyToMessageId: "parent-1",
      replyQuote: "x".repeat(REPLY_QUOTE_MAX_LENGTH + 1),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      json: expect.objectContaining({
        data: expect.objectContaining({
          issues: expect.arrayContaining([expect.objectContaining({ path: ["replyQuote"] })]),
        }),
      }),
    });
  });
});

describe("secret request dismissal", () => {
  function setup(answered: boolean) {
    const answerRunInput = vi.fn().mockResolvedValue(answered);
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      bot: {
        findFirst: vi.fn().mockResolvedValue({
          id: "bot-1",
          thread: { id: "thread-1" },
          computer: null,
        }),
      },
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      events: { answerRunInput },
      jobs: { enqueue },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "https://web.example.test",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const actor = {
      spaceId: "workspace-1",
      userId: "user-1",
      email: "user@example.test",
      isDeploymentOwner: true,
    } satisfies Actor;
    const handler = new RPCHandler(createRouter(deps));
    const send = (json: Record<string, unknown>) =>
      handle(
        handler,
        new Request("https://api.example.test/rpc/threads/answer", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            json: { botId: "bot-1", runId: "run-1", messageId: "message-1", ...json },
          }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
    return { answerRunInput, enqueue, send };
  }

  it.each([
    ["a dismissal with a value", { answer: "example-password", dismiss: true }],
    ["a dismissal with a username", { answer: "", username: "ada", dismiss: true }],
    [
      "a dismissal with fields",
      { answer: "", fields: [{ label: "Code", value: "x", hidden: true }], dismiss: true },
    ],
    [
      "fields with a value in answer",
      { answer: "example-password", fields: [{ label: "Code", value: "x", hidden: true }] },
    ],
    [
      "fields with a username",
      { answer: "", username: "ada", fields: [{ label: "Code", value: "x", hidden: true }] },
    ],
    ["fields without hidden", { answer: "", fields: [{ label: "Code", value: "x" }] }],
    ["an empty answer", { answer: "" }],
    ["not saving an answer that isn't a login", { answer: "123456", remember: false }],
    ["not saving a dismissal", { answer: "", dismiss: true, remember: false }],
    [
      "remember true",
      {
        answer: "",
        fields: [{ label: "Password", value: "x", hidden: true }],
        remember: true,
      },
    ],
  ])("rejects %s before it reaches the run", async (_name, json) => {
    const h = setup(true);
    const response = await h.send(json);

    expect(response.status).toBe(400);
    expect(h.answerRunInput).not.toHaveBeenCalled();
  });
});

describe("MCP server deletion", () => {
  it("does not fail when a concurrent credential rotation already removed the old secret", async () => {
    const deleteServer = vi.fn().mockResolvedValue({ id: "server-1" });
    const deleteSecrets = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      mcpServer: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn().mockResolvedValue({ id: "server-1", secretId: "old-secret" }),
        delete: deleteServer,
      },
      secret: { deleteMany: deleteSecrets },
      message: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma)),
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const actor = {
      spaceId: "workspace-1",
      userId: "user-1",
      email: "user@labradoodle.test",
      isDeploymentOwner: true,
    } satisfies Actor;
    const handler = new RPCHandler(createRouter(deps));

    const response = await handle(
      handler,
      new Request("http://127.0.0.1/rpc/mcp/servers/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { id: "server-1" } }),
      }),
      { prefix: "/rpc", context: { actor } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ json: { ok: true } });
    expect(deleteServer).toHaveBeenCalledWith({ where: { id: "server-1" } });
    expect(deleteSecrets).toHaveBeenCalledWith({
      where: {
        id: "old-secret",
        userId: "user-1",
        spaceId: null,
      },
    });
  });
});

describe("MCP prepared credential updates", () => {
  it("keeps slow secret I/O outside transactions and retries a concurrent OAuth edit", async () => {
    let clock = 0;
    let active = false;
    let writes = 0;
    const server = {
      id: "server",
      spaceId: "space",
      userId: "user",
      slug: "demo",
      name: "Demo",
      description: "",
      enabled: true,
      transport: "streamable_http",
      endpoint: "https://mcp.example.test/mcp",
      secretId: "old",
      revision: 1,
      args: [],
      env: {},
      headers: {},
      command: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const rows = new Map([["old", { id: "old", ciphertext: "old-ref" }]]);
    const values = new Map([
      [
        "old-ref",
        JSON.stringify({ oauth: { tokens: { access_token: "old", token_type: "bearer" } } }),
      ],
    ]);
    const prisma = {
      mcpServer: {
        findMany: vi.fn(async () => []),
        findFirst: async () => ({ ...server }),
        update: async ({
          data,
        }: {
          data: { secretId: string; revision: { increment: number } };
        }) => {
          Object.assign(server, data, { revision: server.revision + data.revision.increment });
          return { ...server };
        },
      },
      secret: {
        findFirst: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
        create: async ({ data }: { data: { id: string; ciphertext: string } }) => {
          rows.set(data.id, data);
          return data;
        },
        deleteMany: async ({ where }: { where: { id: string } }) => {
          rows.delete(where.id);
          return { count: 1 };
        },
        count: async ({ where }: { where: { ciphertext: string } }) =>
          [...rows.values()].filter((row) => row.ciphertext === where.ciphertext).length,
      },
      vaultCredential: { count: async () => 0 },
      integrationProviderConfig: { count: async () => 0 },
      $executeRaw: async () => 1,
      $queryRaw: async () => [],
      async $transaction(callback: (tx: unknown) => Promise<unknown>) {
        active = true;
        const start = clock;
        try {
          const result = await callback(prisma);
          if (clock - start > 5000) throw new Error("Transaction expired");
          return result;
        } finally {
          active = false;
        }
      },
    };
    const secrets = {
      load: async (ref: string) => {
        expect(active).toBe(false);
        clock += 15000;
        return values.get(ref)!;
      },
      put: async (plaintext: string) => {
        expect(active).toBe(false);
        clock += 15000;
        const id = `write-${++writes}`;
        values.set(id, plaintext);
        if (writes === 1) {
          rows.set("concurrent", { id: "concurrent", ciphertext: "concurrent-ref" });
          values.set(
            "concurrent-ref",
            JSON.stringify({
              oauth: { tokens: { access_token: "concurrent", token_type: "bearer" } },
            }),
          );
          server.secretId = "concurrent";
          server.revision++;
        }
        return { id, ref: id, ciphertext: id };
      },
      delete: vi.fn(async (ref: string) => {
        expect(active).toBe(false);
        values.delete(ref);
      }),
    };
    const deps = {
      prisma,
      secrets,
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const actor = {
      spaceId: "space",
      userId: "user",
      email: "user@labradoodle.test",
      isDeploymentOwner: true,
    } satisfies Actor;
    const client = createRouterClient(createRouter(deps), { context: { actor } as never });
    await client.mcp.servers.update({ id: "server", secret: "updated-key" });
    expect(writes).toBe(2);
    expect(values.has("write-1")).toBe(false);
    expect(JSON.parse(values.get(server.secretId)!)).toMatchObject({
      secret: "updated-key",
      oauth: { tokens: { access_token: "concurrent" } },
    });
  });
});

describe("MCP pre-registered OAuth client", () => {
  function harness(
    isDeploymentOwner = true,
    storedMaterial?: Record<string, unknown>,
    allowedCommands: readonly string[] = ["npx"],
  ) {
    const values = new Map<string, string>();
    const secretRows = new Map<string, { id: string; ciphertext: string }>();
    let server: Record<string, unknown> | undefined;
    if (storedMaterial) {
      values.set("cipher-0", JSON.stringify(storedMaterial));
      secretRows.set("secret-0", { id: "secret-0", ciphertext: "cipher-0" });
      server = {
        id: "server-1",
        spaceId: "workspace-1",
        userId: "owner-1",
        slug: "google-drive",
        name: "Google Drive",
        description: "",
        transport: "stdio",
        endpoint: null,
        command: "npx",
        args: [],
        env: { GOOGLE_ACCESS_TOKEN: true },
        files: { GOOGLE_CREDENTIALS_PATH: true },
        headers: {},
        secretId: "secret-0",
        enabled: true,
        revision: 1,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
    }
    const prisma = {
      mcpServer: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => (server ? { ...server } : null)),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const { revision: _revision, ...rest } = data;
          server = { ...server, ...rest, revision: Number(server?.revision) + 1 };
          return server;
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          server = {
            ...data,
            id: "server-1",
            revision: 1,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          };
          return server;
        }),
      },
      mcpOAuthSession: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      secret: {
        create: vi.fn(async ({ data }: { data: { id: string; ciphertext: string } }) => {
          secretRows.set(data.id, data);
          return data;
        }),
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => secretRows.get(where.id)),
        deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
          secretRows.delete(where.id);
          return { count: 1 };
        }),
      },
      user: {
        findUnique: vi.fn(async () => ({ email: "owner@labradoodle.test", emailVerified: true })),
      },
      deploymentSettings: { findUnique: vi.fn().mockResolvedValue({ ownerUserId: "owner-1" }) },
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => []),
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma)),
    } as unknown as PrismaClient;
    const secrets = {
      put: vi.fn(async (plaintext: string) => {
        values.set("cipher-1", plaintext);
        return { id: "secret-1", ciphertext: "cipher-1" };
      }),
      load: vi.fn(async (ciphertext: string) => values.get(ciphertext)!),
    };
    const deps = {
      prisma,
      secrets,
      remoteConnectors: { resolveHostname: async () => [{ address: "203.0.113.10", family: 4 }] },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
        mcpAllowPrivateEndpoint: isDeploymentOwner,
        mcpStdioEnabled: true,
        mcpStdioAllowedCommands: allowedCommands,
        adminEmails: ["owner@labradoodle.test"],
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const actor = {
      spaceId: "workspace-1",
      userId: isDeploymentOwner ? "owner-1" : "member-1",
      email: "owner@labradoodle.test",
      isDeploymentOwner,
    } satisfies Actor;
    return {
      client: createRouterClient(createRouter(deps), { context: { actor } as never }),
      material: () => JSON.parse(values.get("cipher-1")!),
      server: () => server,
      secrets,
      prisma,
    };
  }

  it("stores the client encrypted and returns only its ID", async () => {
    const { client, material, server } = harness();

    const created = await client.mcp.servers.create({
      transport: "streamable_http",
      slug: "gmail",
      name: "Gmail",
      endpoint: "http://localhost:3100/mcp",
      oauthClient: { clientId: "client-1.apps.example.test", clientSecret: "client-secret" },
    });

    expect(created).toMatchObject({
      oauthClientId: "client-1.apps.example.test",
      oauthStatus: "none",
      hasSecret: true,
    });
    expect(JSON.stringify(created)).not.toContain("client-secret");
    expect(server()?.secretId).toBe("secret-1");
    expect(material()).toMatchObject({
      oauthClient: { client_id: "client-1.apps.example.test", client_secret: "client-secret" },
    });
  });

  it("reports a second server with the same name as a conflict", async () => {
    const { client, prisma } = harness();
    vi.mocked(prisma.mcpServer.create).mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    await expect(
      client.mcp.servers.create({
        transport: "streamable_http",
        slug: "gmail",
        name: "Gmail",
        endpoint: "http://localhost:3100/mcp",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "An MCP server with that name already exists.",
    });
  });

  it("rejects a credential in the endpoint query, which would be stored in plaintext", async () => {
    const { client, prisma, secrets } = harness();

    await expect(
      client.mcp.servers.create({
        transport: "streamable_http",
        slug: "gmail",
        name: "Gmail",
        endpoint: "http://localhost:3100/mcp?region=us&api_key=sk-test-123",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Put api_key in a header instead of the server URL",
    });
    expect(secrets.put).not.toHaveBeenCalled();
    expect(prisma.mcpServer.create).not.toHaveBeenCalled();
  });

  it("does not report a stored credential for a lone OAuth generation marker", async () => {
    const { client, server } = harness(true);

    const created = await client.mcp.servers.create({
      transport: "streamable_http",
      slug: "gmail",
      name: "Gmail",
      endpoint: "http://localhost:3100/mcp",
    });
    expect(created.hasSecret).toBe(false);

    await client.mcp.oauth.disconnect({ serverId: created.id });
    // The disconnect of a never-connected server still leaves the generation marker row.
    expect(server()?.secretId).not.toBeNull();

    const checked = await client.mcp.servers.test({ id: created.id });
    expect(checked.hasSecret).toBe(false);
    expect(checked.oauthStatus).toBe("none");
  });

  describe("stdio server with host-managed OAuth", () => {
    const stdio = {
      transport: "stdio" as const,
      slug: "google-drive",
      name: "Google Drive",
      command: "npx",
      args: ["google-drive-mcp"],
    };
    const oauthClient = {
      clientId: "client-1.apps.example.test",
      clientSecret: "client-secret",
      scope: "https://www.googleapis.com/auth/drive.readonly",
      authorizationServer: "https://accounts.example.test",
    };

    it("stores the client and env references encrypted and returns the client ID", async () => {
      const { client, material, server } = harness();

      const created = await client.mcp.servers.create({
        ...stdio,
        env: { GOOGLE_ACCESS_TOKEN: "{{oauth.access_token}}" },
        oauthClient,
      });

      expect(created).toMatchObject({
        oauthClientId: "client-1.apps.example.test",
        oauthStatus: "none",
        envKeys: ["GOOGLE_ACCESS_TOKEN"],
      });
      expect(JSON.stringify(created)).not.toContain("client-secret");
      expect(server()?.env).toEqual({ GOOGLE_ACCESS_TOKEN: true });
      expect(material()).toMatchObject({
        env: { GOOGLE_ACCESS_TOKEN: "{{oauth.access_token}}" },
        oauthClient: {
          client_id: "client-1.apps.example.test",
          client_secret: "client-secret",
          scope: "https://www.googleapis.com/auth/drive.readonly",
          authorization_server: "https://accounts.example.test/",
        },
      });
    });

    it("rejects an unknown OAuth reference, naming the variable and the reference", async () => {
      const { client, secrets } = harness();

      await expect(
        client.mcp.servers.create({
          ...stdio,
          env: { GOOGLE_ACCESS_TOKEN: "Bearer {{oauth.id_token}}" },
          oauthClient,
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/GOOGLE_ACCESS_TOKEN.*oauth\.id_token/),
      });
      expect(secrets.put).not.toHaveBeenCalled();
    });

    it("rejects OAuth references when the server has no OAuth client", async () => {
      const { client, secrets } = harness();

      await expect(
        client.mcp.servers.create({
          ...stdio,
          env: { GOOGLE_ACCESS_TOKEN: "{{oauth.access_token}}" },
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/GOOGLE_ACCESS_TOKEN.*OAuth client/),
      });
      expect(secrets.put).not.toHaveBeenCalled();
    });

    describe("credential files", () => {
      const template = '{"refresh_token":"{{oauth.refresh_token}}"}';

      it("stores the file template encrypted and returns only its key", async () => {
        const { client, material, server } = harness();

        const created = await client.mcp.servers.create({
          ...stdio,
          env: {},
          files: { GOOGLE_CREDENTIALS_PATH: template },
          oauthClient,
        });

        expect(created.fileKeys).toEqual(["GOOGLE_CREDENTIALS_PATH"]);
        expect(JSON.stringify(created)).not.toContain("refresh_token");
        expect(server()?.files).toEqual({ GOOGLE_CREDENTIALS_PATH: true });
        expect(material().files).toEqual({ GOOGLE_CREDENTIALS_PATH: template });
      });

      it("returns no file keys for a server without files", async () => {
        const { client, server } = harness();

        const created = await client.mcp.servers.create({ ...stdio, env: {} });

        expect(created.fileKeys).toEqual([]);
        expect(server()?.files).toEqual({});
      });

      it("rejects an unknown reference in a file, naming the file key", async () => {
        const { client, secrets } = harness();

        await expect(
          client.mcp.servers.create({
            ...stdio,
            env: {},
            files: { GOOGLE_CREDENTIALS_PATH: "{{oauth.id_token}}" },
            oauthClient,
          }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringMatching(/GOOGLE_CREDENTIALS_PATH.*oauth\.id_token/),
        });
        expect(secrets.put).not.toHaveBeenCalled();
      });

      it("rejects file references when the server has no OAuth client", async () => {
        const { client, secrets } = harness();

        await expect(
          client.mcp.servers.create({
            ...stdio,
            env: {},
            files: { GOOGLE_CREDENTIALS_PATH: template },
          }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringMatching(/GOOGLE_CREDENTIALS_PATH.*OAuth client/),
        });
        expect(secrets.put).not.toHaveBeenCalled();
      });

      it("rejects a key used as both an environment variable and a file", async () => {
        const { client, secrets } = harness();

        await expect(
          client.mcp.servers.create({
            ...stdio,
            env: { GOOGLE_CREDENTIALS_PATH: "/tmp/x" },
            files: { GOOGLE_CREDENTIALS_PATH: template },
            oauthClient,
          }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringMatching(/GOOGLE_CREDENTIALS_PATH.*both/),
        });
        expect(secrets.put).not.toHaveBeenCalled();
      });

      describe("update", () => {
        const storedWithFile = {
          env: {},
          files: { GOOGLE_CREDENTIALS_PATH: template },
          oauthClient: { client_id: "client-1.apps.example.test", client_secret: "client-secret" },
        };
        const base = {
          id: "server-1",
          config: { ...stdio, enabled: true, description: "", env: {} },
        };

        it("replaces the files with the supplied set", async () => {
          const { client, material, server } = harness(true, storedWithFile);

          const updated = await client.mcp.servers.update({
            ...base,
            config: { ...base.config, files: { OTHER_PATH: "{{oauth.access_token}}" } },
          });

          expect(updated.fileKeys).toEqual(["OTHER_PATH"]);
          expect(server()?.files).toEqual({ OTHER_PATH: true });
          expect(material().files).toEqual({ OTHER_PATH: "{{oauth.access_token}}" });
        });

        it("keeps the stored files when the update omits them", async () => {
          const { client, material } = harness(true, storedWithFile);

          const updated = await client.mcp.servers.update(base);

          expect(updated.fileKeys).toEqual(["GOOGLE_CREDENTIALS_PATH"]);
          expect(material().files).toEqual({ GOOGLE_CREDENTIALS_PATH: template });
        });

        it("rejects kept file references once the update removes the OAuth client", async () => {
          const { client, secrets } = harness(true, storedWithFile);

          await expect(
            client.mcp.servers.update({
              ...base,
              config: { ...base.config, oauthClient: null },
            }),
          ).rejects.toMatchObject({
            code: "BAD_REQUEST",
            message: expect.stringMatching(/GOOGLE_CREDENTIALS_PATH.*OAuth client/),
          });
          expect(secrets.put).not.toHaveBeenCalled();
        });

        it("rejects an env variable that collides with a kept file", async () => {
          const { client, secrets } = harness(true, storedWithFile);

          await expect(
            client.mcp.servers.update({
              ...base,
              config: { ...base.config, env: { GOOGLE_CREDENTIALS_PATH: "/tmp/x" } },
            }),
          ).rejects.toMatchObject({
            code: "BAD_REQUEST",
            message: expect.stringMatching(/GOOGLE_CREDENTIALS_PATH.*both/),
          });
          expect(secrets.put).not.toHaveBeenCalled();
        });

        it("drops the files but keeps the arguments when the credential is cleared", async () => {
          const { client, material, server } = harness(true, storedWithFile);

          const updated = await client.mcp.servers.update({
            ...base,
            config: { ...base.config, oauthClient: null, clearCredential: true },
          });

          expect(updated.fileKeys).toEqual([]);
          expect(server()?.files).toEqual({});
          expect(material()).toEqual({ args: stdio.args });
        });

        it("drops the secret when the credential is cleared from a server without arguments", async () => {
          const { client, material, server } = harness(true, storedWithFile);

          await client.mcp.servers.update({
            ...base,
            config: {
              ...base.config,
              command: "npx",
              args: [],
              oauthClient: null,
              clearCredential: true,
            },
          });

          expect(server()?.secretId).toBeNull();
          expect(material).toThrow();
        });
      });
    });

    it("refuses a private authorization server from a user who is not the deployment owner", async () => {
      const { client, secrets } = harness(false);

      await expect(
        client.mcp.servers.create({
          ...stdio,
          env: { GOOGLE_ACCESS_TOKEN: "{{oauth.access_token}}" },
          oauthClient: { ...oauthClient, authorizationServer: "http://localhost:3100" },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/HTTPS/) });
      expect(secrets.put).not.toHaveBeenCalled();
    });

    describe("update", () => {
      const update = {
        id: "server-1",
        config: {
          ...stdio,
          enabled: true,
          description: "",
          env: { GOOGLE_ACCESS_TOKEN: "{{oauth.access_token}}" },
        },
      };
      const stored = {
        env: { GOOGLE_ACCESS_TOKEN: "{{oauth.access_token}}" },
        oauthClient: {
          client_id: "client-1.apps.example.test",
          client_secret: "client-secret",
          scope: "drive.readonly",
          authorization_server: "https://accounts.example.test/",
        },
        oauth: { tokens: { access_token: "granted" } },
      };

      it("rechecks a retained issuer before storing updated material", async () => {
        const { client, secrets } = harness(false, {
          ...stored,
          oauthClient: { ...stored.oauthClient, authorization_server: "https://127.0.0.1/" },
        });
        await expect(client.mcp.servers.update(update)).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
        expect(secrets.put).not.toHaveBeenCalled();
      });

      it("rejects references once the update removes the OAuth client", async () => {
        const { client, secrets } = harness(true, stored);

        await expect(
          client.mcp.servers.update({
            ...update,
            config: { ...update.config, oauthClient: null },
          }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringMatching(/GOOGLE_ACCESS_TOKEN.*OAuth client/),
        });
        expect(secrets.put).not.toHaveBeenCalled();
      });

      it("rejects an unknown reference even when the stored client is kept", async () => {
        const { client, secrets } = harness(true, stored);

        await expect(
          client.mcp.servers.update({
            ...update,
            config: { ...update.config, env: { GOOGLE_ACCESS_TOKEN: "{{oauth.id_token}}" } },
          }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringMatching(/GOOGLE_ACCESS_TOKEN.*oauth\.id_token/),
        });
        expect(secrets.put).not.toHaveBeenCalled();
      });

      it("keeps the stored client and its grant when the update leaves the client out", async () => {
        const { client, material } = harness(true, stored);

        const updated = await client.mcp.servers.update(update);

        expect(updated.oauthClientId).toBe("client-1.apps.example.test");
        expect(material()).toEqual({ ...stored, args: stdio.args });
      });

      it("clears the grant when the update changes the scope", async () => {
        const { client, material } = harness(true, stored);

        await client.mcp.servers.update({
          ...update,
          config: {
            ...update.config,
            oauthClient: {
              clientId: "client-1.apps.example.test",
              scope: "drive",
              authorizationServer: "https://accounts.example.test",
            },
          },
        });

        expect(material().oauth).toBeUndefined();
        expect(material().oauthClient).toEqual({
          client_id: "client-1.apps.example.test",
          client_secret: "client-secret",
          scope: "drive",
          authorization_server: "https://accounts.example.test/",
        });
      });

      it("clears the stored credential when the command changes and none is sent", async () => {
        const { client, server, secrets, prisma } = harness(
          true,
          { args: [...stdio.args, "--token", "stored-token"] },
          ["npx", "node"],
        );

        const updated = await client.mcp.servers.update({
          ...update,
          config: { ...stdio, command: "node", args: [], env: {}, enabled: true, description: "" },
        });

        expect(updated.hasSecret).toBe(false);
        expect(updated.hasArgs).toBe(false);
        expect(server()?.secretId).toBeNull();
        expect(secrets.put).not.toHaveBeenCalled();
        expect(prisma.secret.deleteMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ id: "secret-0" }) }),
        );
      });

      it("deletes a stored credential that holds only an empty env record", async () => {
        const { client, server, secrets, prisma } = harness(true, { env: {} });

        const updated = await client.mcp.servers.update({
          ...update,
          config: { ...stdio, args: [], env: {}, enabled: true, description: "" },
        });

        expect(updated.hasSecret).toBe(false);
        expect(server()?.secretId).toBeNull();
        expect(secrets.put).not.toHaveBeenCalled();
        expect(prisma.secret.deleteMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ id: "secret-0" }) }),
        );
      });
    });

    it("allows a private authorization server only with operator configuration", async () => {
      const { client } = harness();

      await expect(
        client.mcp.servers.create({
          ...stdio,
          env: { GOOGLE_ACCESS_TOKEN: "{{oauth.access_token}}" },
          oauthClient: { ...oauthClient, authorizationServer: "http://localhost:3100" },
        }),
      ).resolves.toMatchObject({ oauthClientId: "client-1.apps.example.test" });
    });
  });
});

describe("MCP loopback endpoints", () => {
  const LOOPBACK = "http://localhost:3100/api/auth/get-session";

  function mcpDeps(mcpAllowPrivateEndpoint = false) {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      id: "server-1",
      secretId: null,
      revision: 1,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));
    const prisma = {
      mcpServer: {
        findMany: vi.fn(async () => []),
        create,
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "server-1", endpoint: LOOPBACK, secretId: null }),
      },
      mcpOAuthSession: {
        count: vi.fn().mockResolvedValue(0),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      secret: { findFirst: vi.fn() },
      deploymentSettings: { findUnique: vi.fn().mockResolvedValue({ ownerUserId: "owner-1" }) },
      $executeRaw: vi.fn(async () => 0),
      $queryRaw: vi.fn(async () => []),
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma)),
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
        mcpAllowPrivateEndpoint,
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    return { create, handler: new RPCHandler(createRouter(deps)) };
  }

  function actor(isDeploymentOwner: boolean): Actor {
    return {
      spaceId: "workspace-1",
      userId: isDeploymentOwner ? "owner-1" : "member-1",
      email: "user@labradoodle.test",
      isDeploymentOwner,
    };
  }

  function rpc(path: string, json: unknown) {
    return new Request(`http://127.0.0.1/rpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json }),
    });
  }

  const createInput = {
    transport: "streamable_http",
    slug: "local",
    name: "Local",
    endpoint: LOOPBACK,
  };

  it("refuses a loopback endpoint from a user who is not the deployment owner", async () => {
    const { create, handler } = mcpDeps();
    const response = await handle(handler, rpc("mcp/servers/create", createInput), {
      prefix: "/rpc",
      context: { actor: actor(false) },
    });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("allows a loopback endpoint under explicit operator configuration", async () => {
    const { create, handler } = mcpDeps(true);
    const response = await handle(handler, rpc("mcp/servers/create", createInput), {
      prefix: "/rpc",
      context: { actor: actor(true) },
    });

    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("refuses to start OAuth against a stored loopback endpoint for a non-owner", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const { handler } = mcpDeps();
      const response = await handle(
        handler,
        rpc("mcp/oauth/begin", {
          serverId: "server-1",
          redirectUri: "http://127.0.0.1:5173/mcp/oauth/callback",
        }),
        { prefix: "/rpc", context: { actor: actor(false) } },
      );

      expect(response.status).toBe(400);
      const body = (await response.json()) as { json: { message: string } };
      expect(body.json.message).toMatch(/HTTPS/);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("MCP server health", () => {
  type Row = Record<string, unknown>;
  const baseRow = (overrides: Row = {}): Row => ({
    id: "server-1",
    spaceId: "workspace-1",
    userId: "owner-1",
    slug: "gmail",
    name: "Gmail",
    description: "",
    transport: "stdio",
    endpoint: null,
    command: "npx",
    args: ["-y", "@klodr/gmail-mcp@2.0.2"],
    env: {},
    files: {},
    headers: {},
    secretId: null,
    enabled: true,
    revision: 1,
    healthStatus: "unknown",
    healthMessage: null,
    healthToolCount: null,
    healthCheckedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  });

  function harness(options: { row?: Row | null; oauth?: McpOAuthSummary; probe?: unknown } = {}) {
    let server: Row | null = options.row === undefined ? baseRow() : options.row;
    const probe = vi.fn<(...args: unknown[]) => Promise<unknown>>(
      (options.probe as (() => Promise<unknown>) | undefined) ??
        (async () => {
          await recordHealth({ healthStatus: "ok", healthToolCount: 4 });
          return { status: "ok", toolCount: 4 };
        }),
    );
    const recordHealth = async (patch: Row) => {
      if (server) server = { ...server, healthCheckedAt: new Date(5), ...patch };
    };
    const updateMany = vi.fn(async ({ data }: { data: Row }) => {
      await recordHealth(data);
      return { count: server ? 1 : 0 };
    });
    const matches = (where: Row): boolean =>
      Boolean(server) &&
      Object.entries(where).every(([key, value]) =>
        key === "OR"
          ? (value as Row[]).some((branch) => matches(branch))
          : (server as Row)[key] === value,
      );
    const prisma = {
      mcpServer: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async ({ where }: { where: Row }) =>
          matches(where) ? { ...server } : null,
        ),
        create: vi.fn(async ({ data }: { data: Row }) => {
          server = baseRow({ ...data, id: "server-1" });
          return { ...server };
        }),
        update: vi.fn(async ({ data }: { data: Row }) => {
          const { revision: _revision, ...rest } = data;
          server = { ...server, ...rest, revision: Number(server?.revision) + 1 };
          return { ...server };
        }),
        updateMany,
      },
      secret: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
      user: {
        findUnique: vi.fn(async () => ({ email: "owner@labradoodle.test", emailVerified: true })),
        findUniqueOrThrow: vi.fn(async () => ({
          email: "owner@labradoodle.test",
          name: "Owner",
          secrets: [],
        })),
      },
      deploymentSettings: { findUnique: vi.fn().mockResolvedValue({ ownerUserId: "owner-1" }) },
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => []),
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma)),
    } as unknown as PrismaClient;
    const summaryFor = vi.fn(
      async () => options.oauth ?? { status: "none", clientId: null, credential: true },
    );
    const deps = {
      prisma,
      secrets: { put: vi.fn(), load: vi.fn() },
      remoteConnectors: { resolveHostname: async () => [{ address: "203.0.113.10", family: 4 }] },
      mcpOAuth: { summaryFor, summaryForCiphertext: summaryFor },
      mcp: { probe },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
        mcpStdioEnabled: true,
        mcpStdioAllowedCommands: ["npx"],
        adminEmails: ["owner@labradoodle.test"],
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const clientFor = (actor: Partial<Actor> = {}) =>
      createRouterClient(createRouter(deps), {
        context: {
          actor: {
            spaceId: "workspace-1",
            userId: "owner-1",
            email: "owner@labradoodle.test",
            isDeploymentOwner: true,
            ...actor,
          },
        } as never,
      });
    return {
      client: clientFor(),
      clientFor,
      probe,
      updateMany,
      row: () => server,
      deps,
      createRouterWithoutProbe: () =>
        createRouterClient(createRouter({ ...deps, mcp: undefined } as RouterDeps), {
          context: {
            actor: {
              spaceId: "workspace-1",
              userId: "owner-1",
              email: "owner@labradoodle.test",
              isDeploymentOwner: true,
            },
          } as never,
        }),
    };
  }

  const stdioInput = {
    transport: "stdio" as const,
    slug: "gmail",
    name: "Gmail",
    command: "npx",
    args: ["-y", "@klodr/gmail-mcp@2.0.2"],
  };

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it.each([
    [{ mcpStdioEnabled: false }, "Stdio MCP servers aren't available here"],
    [{ mcpStdioAllowedCommands: [] }, "Stdio MCP servers aren't available here"],
    [{ mcpStdioAllowedCommands: ["uvx"] }, "This stdio command isn't allowed here"],
  ])("refuses a stdio server this deployment can't run (%o)", async (env, message) => {
    const h = harness();
    Object.assign(h.deps.env, env);

    await expect(h.client.mcp.servers.create(stdioInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message,
    });
    await expect(
      h.client.mcp.servers.update({
        id: "server-1",
        config: { ...stdioInput, enabled: true, description: "", env: {} },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message });
    expect(h.deps.prisma.mcpServer.create).not.toHaveBeenCalled();
    expect(h.deps.prisma.mcpServer.update).not.toHaveBeenCalled();
    expect(h.probe).not.toHaveBeenCalled();
  });

  it("lists servers with their health", async () => {
    const h = harness({
      row: baseRow({
        healthStatus: "error",
        healthMessage: "spawn npx ENOENT",
        healthCheckedAt: new Date("2026-10-21T10:00:00.000Z"),
      }),
    });
    (h.deps.prisma.mcpServer as unknown as { findMany: unknown }).findMany = vi.fn(async () => [
      h.row(),
    ]);

    const [listed] = await h.client.mcp.servers.list();

    expect(listed?.health).toEqual({
      status: "error",
      message: "spawn npx ENOENT",
      code: null,
      toolCount: null,
      checkedAt: "2026-10-21T10:00:00.000Z",
    });
  });

  describe("test", () => {
    it("probes the server and returns the recorded health", async () => {
      const { client, probe } = harness();

      const tested = await client.mcp.servers.test({ id: "server-1" });

      expect(probe).toHaveBeenCalledTimes(1);
      expect(probe.mock.calls[0]?.[1]).toMatchObject({ spaceId: "workspace-1", userId: "owner-1" });
      expect(tested.health).toMatchObject({ status: "ok", toolCount: 4, message: null });
      expect(tested.health.checkedAt).not.toBeNull();
    });

    it("refuses another user's server without probing it", async () => {
      const { clientFor, probe } = harness();

      await expect(
        clientFor({ userId: "member-1" }).mcp.servers.test({ id: "server-1" }),
      ).rejects.toThrow();
      await expect(clientFor().mcp.servers.test({ id: "does-not-exist" })).rejects.toThrow();
      expect(probe).not.toHaveBeenCalled();
    });

    it("returns an error health instead of a 500 when the probe throws", async () => {
      const { client } = harness({
        probe: async () => {
          throw new Error("MCP stdio is disabled");
        },
      });

      const tested = await client.mcp.servers.test({ id: "server-1" });

      expect(tested.health).toMatchObject({
        status: "error",
        message: "Could not check this MCP server",
      });
    });

    it("says why it did not probe when the server still needs its OAuth account", async () => {
      const { client, probe } = harness({
        oauth: { status: "none", clientId: "client-1.apps.example.test", credential: true },
      });

      const tested = await client.mcp.servers.test({ id: "server-1" });

      expect(probe).not.toHaveBeenCalled();
      expect(tested.health.status).toBe("unknown");
      expect(tested.health.message).toMatch(/account/);
    });

    it.each([
      [{ secret: "fake-token" }, true],
      [{ headers: { Authorization: "fake-token" } }, true],
      [{ secret: "fake-token", env: { TOKEN: "{{oauth.access_token}}" } }, false],
      [{ secret: "fake-token", files: { CONFIG: "{{oauth.access_token}}" } }, false],
    ])(
      "checks static credentials unless templates need a grant: %j",
      async (material, shouldProbe) => {
        const h = harness({
          row: baseRow({ secretId: "secret-1" }),
          oauth: { status: "none", clientId: "fake-client", credential: true },
        });
        vi.mocked(h.deps.prisma.secret.findFirst).mockResolvedValue({
          id: "secret-1",
          ciphertext: "fake-ciphertext",
        } as never);
        vi.mocked(h.deps.secrets.load).mockResolvedValue(JSON.stringify(material));
        await h.client.mcp.servers.test({ id: "server-1" });
        expect(h.probe).toHaveBeenCalledTimes(shouldProbe ? 1 : 0);
      },
    );

    it("reports an error when this process has no MCP connector", async () => {
      const h = harness();

      const tested = await h.createRouterWithoutProbe().mcp.servers.test({ id: "server-1" });

      expect(tested.health.status).toBe("error");
    });
  });

  describe("automatic probe", () => {
    it("shows a new stdio server as installing and probes it in the background", async () => {
      const { client, probe, row } = harness({ row: null });

      const created = await client.mcp.servers.create(stdioInput);
      expect(created.health.status).toBe("installing");
      await flush();

      expect(probe).toHaveBeenCalledTimes(1);
      expect(row()?.healthStatus).toBe("ok");
    });

    it("probes a new remote server without claiming it is installing", async () => {
      const { client, probe } = harness({ row: null });

      const created = await client.mcp.servers.create({
        transport: "streamable_http",
        slug: "docs",
        name: "Docs",
        endpoint: "https://mcp.example.test/mcp",
      });
      await flush();

      expect(created.health.status).toBe("unknown");
      expect(probe).toHaveBeenCalledTimes(1);
    });

    it("does not fail the create when the probe fails", async () => {
      const { client, row } = harness({
        row: null,
        probe: async () => {
          throw new Error("boom");
        },
      });

      const created = await client.mcp.servers.create(stdioInput);
      await flush();

      expect(created.id).toBe("server-1");
      expect(row()).toMatchObject({
        healthStatus: "error",
        healthMessage: "Could not check this MCP server",
      });
    });

    it("does not probe a server whose OAuth account is not connected", async () => {
      const { client, probe, row } = harness({
        row: null,
        oauth: { status: "none", clientId: "client-1.apps.example.test", credential: true },
      });

      const created = await client.mcp.servers.create(stdioInput);
      await flush();

      expect(probe).not.toHaveBeenCalled();
      expect(created.health.status).toBe("unknown");
      expect(row()?.healthMessage).toMatch(/account/);
    });

    it("does not probe a disabled server", async () => {
      const { client, probe } = harness({ row: null });

      await client.mcp.servers.create({ ...stdioInput, enabled: false });
      await flush();

      expect(probe).not.toHaveBeenCalled();
    });

    it("resets health when the config changes and probes the new config", async () => {
      const { client, probe, row } = harness({
        row: baseRow({ healthStatus: "error", healthMessage: "old failure", healthToolCount: 2 }),
      });
      const seen: unknown[] = [];
      probe.mockImplementation(async () => {
        seen.push({ ...row() });
        return { status: "ok" };
      });

      const updated = await client.mcp.servers.update({
        id: "server-1",
        config: { ...stdioInput, name: "Gmail 2", args: ["-y", "@klodr/gmail-mcp@2.1.0"] },
      });
      await flush();

      expect(updated.revision).toBe(2);
      expect(updated.health.status).toBe("installing");
      expect(updated.health.message).toBeNull();
      expect(probe).toHaveBeenCalledTimes(1);
      expect(seen[0]).toMatchObject({ healthStatus: "installing", healthMessage: null });
    });

    it("does not probe when no MCP connector is wired", async () => {
      const h = harness({ row: null });

      const created = await h.createRouterWithoutProbe().mcp.servers.create(stdioInput);

      expect(created.health.status).toBe("unknown");
      expect(h.updateMany).not.toHaveBeenCalled();
    });

    it("keeps stdio arguments in the encrypted credential, never in the row or the response", async () => {
      const h = harness({ row: null });
      const put = vi.mocked(h.deps.secrets.put).mockResolvedValue({
        id: "secret-1",
        ciphertext: "v2:fake",
      } as never);

      const created = await h.client.mcp.servers.create({
        ...stdioInput,
        args: ["--api-key", "fake-key"],
      });

      expect(JSON.parse(String(put.mock.calls[0]?.[0]))).toMatchObject({
        args: ["--api-key", "fake-key"],
      });
      const data = vi.mocked(h.deps.prisma.mcpServer.create).mock.calls[0]?.[0].data;
      expect(data).not.toHaveProperty("args");
      expect(data).toMatchObject({ hasArgs: true, secretId: "secret-1" });
      expect(created).not.toHaveProperty("args");
      expect(created.hasArgs).toBe(true);
    });

    it("moves a server's plaintext arguments into its credential when it is saved", async () => {
      const h = harness({ row: baseRow({ args: ["--api-key", "fake-key"] }) });
      const put = vi.mocked(h.deps.secrets.put).mockResolvedValue({
        id: "secret-1",
        ciphertext: "v2:fake",
      } as never);

      const updated = await h.client.mcp.servers.update({
        id: "server-1",
        config: { ...stdioInput, args: [] },
      });

      expect(JSON.parse(String(put.mock.calls[0]?.[0]))).toMatchObject({
        args: ["--api-key", "fake-key"],
      });
      expect(h.row()).toMatchObject({ args: [], hasArgs: true, secretId: "secret-1" });
      expect(updated.hasArgs).toBe(true);
    });

    it("still reports arguments a server kept in plaintext", async () => {
      const h = harness();
      (h.deps.prisma.mcpServer as unknown as { findMany: unknown }).findMany = vi.fn(async () => [
        h.row(),
      ]);

      const [listed] = await h.client.mcp.servers.list();

      expect(listed).not.toHaveProperty("args");
      expect(listed?.hasArgs).toBe(true);
    });

    it("asks for a client ID when the server cannot register one", async () => {
      const h = harness({
        row: baseRow({ transport: "streamable_http", endpoint: "https://mcp.example.test/mcp" }),
      });
      Object.assign(h.deps, {
        mcpOAuth: {
          ...(h.deps.mcpOAuth as object),
          begin: vi.fn().mockRejectedValue(new McpOAuthClientRequiredError(1)),
        },
      });
      const client = createRouterClient(createRouter(h.deps), {
        context: {
          actor: {
            spaceId: "workspace-1",
            userId: "owner-1",
            email: "owner@labradoodle.test",
            isDeploymentOwner: true,
          },
        } as never,
      });

      await expect(
        client.mcp.oauth.begin({
          serverId: "server-1",
          redirectUri: "http://127.0.0.1:5173/mcp/oauth/callback",
        }),
      ).rejects.toMatchObject({ code: MCP_OAUTH_CLIENT_REQUIRED });
      expect(h.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "server-1", revision: 1 } }),
      );
      (h.deps.prisma.mcpServer as unknown as { findMany: unknown }).findMany = vi.fn(async () => [
        h.row(),
      ]);
      const [listed] = await client.mcp.servers.list();
      expect(listed?.health).toMatchObject({ status: "error", code: MCP_OAUTH_CLIENT_REQUIRED });
    });

    it.each([
      "http://localhost:5173/mcp/oauth/callback",
      "http://127.0.0.1:5180/mcp/oauth/callback",
      "https://127.0.0.1:5173/mcp/oauth/callback",
      "http://127.0.0.1:5173/other-callback",
    ])("rejects an unregistered callback before starting OAuth: %s", async (redirectUri) => {
      const h = harness({
        row: baseRow({
          transport: "streamable_http",
          endpoint: "https://mcp.example.test/mcp",
        }),
      });
      const begin = vi.fn();
      Object.assign(h.deps, {
        mcpOAuth: { ...(h.deps.mcpOAuth as object), begin },
      });
      const client = createRouterClient(createRouter(h.deps), {
        context: {
          actor: {
            spaceId: "workspace-1",
            userId: "owner-1",
            email: "owner@labradoodle.test",
            isDeploymentOwner: true,
          },
        } as never,
      });

      await expect(
        client.mcp.oauth.begin({ serverId: "server-1", redirectUri }),
      ).rejects.toMatchObject({
        code: "MCP_OAUTH_REDIRECT_MISMATCH",
        status: 400,
      });
      expect(begin).not.toHaveBeenCalled();
    });

    it("uses the registered web callback when a native client omits the redirect", async () => {
      const h = harness({
        row: baseRow({ transport: "streamable_http", endpoint: "https://mcp.example.test/mcp" }),
      });
      const begin = vi.fn(async () => ({ status: "already_connected" as const }));
      Object.assign(h.deps, { mcpOAuth: { ...(h.deps.mcpOAuth as object), begin } });
      const client = createRouterClient(createRouter(h.deps), {
        context: {
          actor: {
            spaceId: "workspace-1",
            userId: "owner-1",
            email: "owner@labradoodle.test",
            isDeploymentOwner: true,
          },
        } as never,
      });

      await expect(client.mcp.oauth.begin({ serverId: "server-1" })).resolves.toEqual({
        status: "already_connected",
      });
      expect(begin).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUri: new URL("/mcp/oauth/callback", h.deps.env.webOrigin).toString(),
        }),
      );
    });

    it("probes the server once its OAuth session completes", async () => {
      const h = harness({ row: baseRow() });
      const complete = vi.fn(async () => undefined);
      Object.assign(h.deps, {
        mcpOAuth: {
          ...(h.deps.mcpOAuth as object),
          complete,
        },
      });
      (h.deps.prisma as unknown as { mcpOAuthSession: unknown }).mcpOAuthSession = {
        findFirst: vi.fn(async () => ({ serverId: "server-1" })),
      };
      const client = createRouterClient(createRouter(h.deps), {
        context: {
          actor: {
            spaceId: "workspace-1",
            userId: "owner-1",
            email: "owner@labradoodle.test",
            isDeploymentOwner: true,
          },
        } as never,
      });

      await client.mcp.oauth.complete({ sessionId: "session-1", code: "code", state: "session-1" });
      await flush();

      expect(complete).toHaveBeenCalledTimes(1);
      expect(h.probe).toHaveBeenCalledTimes(1);
    });
  });
});

describe("private API connectors", () => {
  function privateDeps(mcpAllowPrivateEndpoint = false) {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      id: "install-1",
      secretId: null,
      version: "1.0.0",
      digest: "sha256:fake",
      createdAt: new Date(0),
    }));
    const prisma = {
      capabilityInstall: { create },
      $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(prisma)),
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
        mcpAllowPrivateEndpoint,
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    return { create, handler: new RPCHandler(createRouter(deps)) };
  }

  function actor(isDeploymentOwner: boolean): Actor {
    return {
      spaceId: "workspace-1",
      userId: isDeploymentOwner ? "owner-1" : "member-1",
      email: "user@labradoodle.test",
      isDeploymentOwner,
    };
  }

  function rpc(path: string, json: unknown) {
    return new Request(`http://127.0.0.1/rpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json }),
    });
  }

  const installInput = {
    kind: "api",
    name: "Local API",
    source: "http://localhost:4000",
    config: {
      auth: { type: "none" },
      operations: [{ id: "list_items", method: "GET", path: "/items" }],
    },
  };

  it.each([
    ["a legacy owner under the instance flag", true, true],
    ["every user under the instance flag", false, true],
  ])("lets %s install a loopback API connector", async (_label, owner, flag) => {
    const { create, handler } = privateDeps(flag);
    const response = await handle(handler, rpc("capabilities/install", installInput), {
      prefix: "/rpc",
      context: { actor: actor(owner) },
    });

    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("refuses a loopback API connector from a user who is not the deployment owner", async () => {
    const { create, handler } = privateDeps();
    const response = await handle(handler, rpc("capabilities/install", installInput), {
      prefix: "/rpc",
      context: { actor: actor(false) },
    });

    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("connections.begin", () => {
  it("reuses a revoked row for the same provider instead of inserting a duplicate", async () => {
    const begin = vi.fn().mockResolvedValue({ state: "gmail-state", authorizationUrl: null });
    const update = vi.fn().mockResolvedValue({
      id: "conn-old",
      connectorId: "composio",
      provider: "gmail",
      displayName: "Gmail",
      status: "pending",
      createdAt: new Date("2026-08-26T00:00:00.000Z"),
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn();
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue(undefined),
          connection: {
            findMany: vi.fn().mockResolvedValue([{ id: "conn-old", status: "revoked" }]),
            update,
            updateMany,
            create,
          },
        };
        return fn(tx);
      }),
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      connectors: {
        managed: vi.fn(() => ({ begin })),
      },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const actor = {
      spaceId: "workspace-1",
      userId: "user-1",
      email: "user@labradoodle.test",
      isDeploymentOwner: true,
    } satisfies Actor;
    const handler = new RPCHandler(createRouter(deps));

    const response = await handle(
      handler,
      new Request("http://127.0.0.1/rpc/connections/begin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          json: {
            connectorId: "composio",
            provider: "gmail",
            displayName: "Gmail",
          },
        }),
      }),
      { prefix: "/rpc", context: { actor } },
    );

    expect(response.status).toBe(200);
    expect(begin).toHaveBeenCalledWith(
      { provider: "gmail", redirectUrl: "http://127.0.0.1:5173/integrations/callback" },
      expect.anything(),
    );
    // Complete and revoke hold the same lock across provider calls; begin must outwait them.
    expect(vi.mocked(prisma.$transaction).mock.calls.map((call) => call[1])).toEqual([
      { timeout: 60_000 },
      { timeout: 60_000 },
    ]);
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: "conn-old" },
      data: {
        displayName: "Gmail",
        status: "pending",
        providerRef: null,
        metadata: {},
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      json: { connectionId: "conn-old" },
    });
  });

  it("cancels the remote authorization when its result cannot be saved before the slot frees", async () => {
    vi.useFakeTimers();
    let releaseSlot = () => {};
    let holder: Promise<void> = Promise.resolve();
    const begin = vi.fn(async () => {
      // Another provider call takes this scope's slot while this one talks to the provider.
      holder = runProviderTransaction(
        providerScopeKey({ spaceId: "workspace-1", userId: "user-1" }, "composio", "gmail"),
        () =>
          new Promise<void>((resolve) => {
            releaseSlot = resolve;
          }),
        120_000,
      );
      return { state: "request-1", authorizationUrl: "https://provider.test/authorize" };
    });
    const cancelAuthorizationRequest = vi.fn(async () => undefined);
    const rootUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      connection: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "conn-1", status: "pending" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      connection: { updateMany: rootUpdateMany },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const handler = new RPCHandler(
      createRouter({
        prisma,
        connectors: { managed: vi.fn(() => ({ begin, cancelAuthorizationRequest })) },
        env: {
          defaultProvider: "fake",
          defaultModel: "fake-model",
          webOrigin: "http://127.0.0.1:5173",
          screenProxySecret: "fake-test-secret",
          sandboxProvider: "fake",
        },
        dataDir: "/tmp/labradoodle-router-test",
      } as unknown as RouterDeps),
    );
    try {
      const handled = handle(
        handler,
        new Request("http://127.0.0.1/rpc/connections/begin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            json: { connectorId: "composio", provider: "gmail", displayName: "Gmail" },
          }),
        }),
        {
          prefix: "/rpc",
          context: {
            actor: {
              spaceId: "workspace-1",
              userId: "user-1",
              email: "user@labradoodle.test",
              isDeploymentOwner: true,
            },
          },
        },
      );
      await vi.advanceTimersByTimeAsync(60_000);
      const response = await handled;

      expect(response.status).not.toBe(200);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.connection.updateMany).not.toHaveBeenCalled();
      expect(cancelAuthorizationRequest).toHaveBeenCalledWith("request-1", expect.anything());
      expect(rootUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: "error" } }),
      );
    } finally {
      releaseSlot();
      await holder;
      vi.useRealTimers();
    }
  });

  it("answers with the connector auth code when the app has no usable sign-in", async () => {
    const begin = vi.fn().mockRejectedValue(
      new ConnectorAuthUnavailableError({
        cause: '400 {"error":{"slug":"ToolRouterV2_NoManagedAuth"}}',
      }),
    );
    const rootUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(undefined),
      connection: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: "conn-1", status: "pending" }),
      },
    };
    const prisma = {
      connection: { updateMany: rootUpdateMany },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const handler = new RPCHandler(
      createRouter({
        prisma,
        connectors: { managed: vi.fn(() => ({ begin })) },
        env: {
          defaultProvider: "fake",
          defaultModel: "fake-model",
          webOrigin: "http://127.0.0.1:5173",
          screenProxySecret: "fake-test-secret",
          sandboxProvider: "fake",
        },
        dataDir: "/tmp/labradoodle-router-test",
      } as unknown as RouterDeps),
    );

    const response = await handle(
      handler,
      new Request("http://127.0.0.1/rpc/connections/begin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          json: { connectorId: "composio", provider: "twitter", displayName: "Twitter" },
        }),
      }),
      {
        prefix: "/rpc",
        context: {
          actor: {
            spaceId: "workspace-1",
            userId: "user-1",
            email: "user@labradoodle.test",
            isDeploymentOwner: true,
          },
        },
      },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ json: { code: CONNECTOR_AUTH_UNAVAILABLE } });
    expect(JSON.stringify(body)).not.toContain("ToolRouterV2_NoManagedAuth");
    expect(rootUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "error" } }),
    );
  });
});

describe("connections.complete", () => {
  it.each([
    ["complete", false],
    ["complete", true],
    ["revoke", false],
    ["revoke", true],
  ] as const)(
    "prepares slow configured credentials for %s (changed: %s)",
    async (operation, changed) => {
      const secrets = new EncryptedSecretStore("test-encryption-key");
      const stored = await secrets.put(
        JSON.stringify({ provider: "composio", apiKey: "fake-key" }),
        {
          operationId: "test",
          traceId: "test",
          spaceId: "workspace-1",
          userId: "user-1",
          signal: new AbortController().signal,
        },
        { recordId: "integration-provider:composio" },
      );
      let ref = stored.ref;
      let inTransaction = false;
      let elapsed = 0;
      const originalLoad = EncryptedSecretStore.prototype.load.bind(secrets);
      const load = vi.spyOn(secrets, "load").mockImplementation(async (...args) => {
        expect(inTransaction).toBe(false);
        elapsed += 15_000;
        return originalLoad(...args);
      });
      const row = {
        id: "conn-1",
        connectorId: "composio",
        provider: "gmail",
        providerRef: "gmail",
        displayName: "Gmail",
        status: "pending",
        createdAt: new Date(0),
      };
      const client = {
        integrationProviderConfig: {
          findUnique: vi.fn(async () => ({ id: "composio", ciphertext: ref })),
        },
        connection: {
          findFirst: vi.fn(async () => row),
          findMany: vi.fn(async () => []),
          count: vi.fn(async () => 0),
          updateMany: vi.fn(async () => ({ count: 1 })),
        },
        $executeRaw: vi.fn(),
        $queryRaw: vi.fn(async () => [{ locked: true }]),
      };
      const prisma = {
        ...client,
        $transaction: vi.fn(async (fn: (tx: typeof client) => Promise<unknown>) => {
          const started = elapsed;
          if (changed) ref = "replacement-ref";
          inTransaction = true;
          try {
            const result = await fn(client);
            expect(elapsed - started).toBeLessThan(5_000);
            return result;
          } finally {
            inTransaction = false;
          }
        }),
      };
      const complete = vi.fn(async () => ({ connectionRef: "gmail" }));
      const revoke = vi.fn(async () => undefined);
      const adapter = {
        complete,
        revoke,
        connectionReady: vi.fn(async () => false),
      } as unknown as ManagedConnectorProvider;
      const settings = new IntegrationProviderSettings(
        prisma as unknown as PrismaClient,
        secrets,
        "fake-identity",
        {},
        () => adapter,
      );
      const connector = settings
        .providers()
        .find((provider) => provider.describe().id === "composio");
      const handler = new RPCHandler(
        createRouter({
          prisma,
          connectors: { managed: () => connector },
          env: {
            defaultProvider: "fake",
            defaultModel: "fake-model",
            webOrigin: "http://127.0.0.1:5173",
            screenProxySecret: "fake-test-secret",
            sandboxProvider: "fake",
          },
        } as unknown as RouterDeps),
      );
      const response = await handle(
        handler,
        new Request(`http://127.0.0.1/rpc/connections/${operation}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            json: {
              connectionId: row.id,
              ...(operation === "complete" ? { code: "fake-code" } : {}),
            },
          }),
        }),
        {
          prefix: "/rpc",
          context: {
            actor: {
              spaceId: "workspace-1",
              userId: "user-1",
              email: "user@labradoodle.test",
              isDeploymentOwner: true,
            },
          },
        },
      );
      expect(response.status).toBe(changed ? 409 : 200);
      expect(elapsed).toBe(15_000);
      expect(load).toHaveBeenCalledTimes(1);
      expect(operation === "complete" ? complete : revoke).toHaveBeenCalledTimes(changed ? 0 : 1);
    },
  );

  it("forwards an optional code to the managed connector", async () => {
    const complete = vi.fn().mockResolvedValue({ connectionRef: "gmail" });
    const connectionReady = vi.fn().mockResolvedValue(true);
    const update = vi.fn().mockResolvedValue({
      id: "conn-1",
      connectorId: "composio",
      provider: "gmail",
      displayName: "Gmail",
      status: "connected",
      createdAt: new Date("2026-08-26T00:00:00.000Z"),
    });
    const prisma = {
      connection: {
        findFirst: vi.fn().mockResolvedValue({
          id: "conn-1",
          connectorId: "composio",
          provider: "gmail",
          displayName: "Gmail",
          providerRef: "gmail-state",
          status: "pending",
          createdAt: new Date("2026-08-26T00:00:00.000Z"),
        }),
        findMany: vi.fn().mockResolvedValue([]),
        update,
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const row = {
          id: "conn-1",
          connectorId: "composio",
          provider: "gmail",
          displayName: "Gmail",
          providerRef: "gmail-state",
          status: "pending",
          createdAt: new Date("2026-08-26T00:00:00.000Z"),
        };
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue(undefined),
          $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
          connection: {
            findFirst: vi
              .fn()
              .mockResolvedValueOnce(row)
              .mockResolvedValueOnce(null)
              .mockResolvedValueOnce({ ...row, status: "connected" }),
            findMany: vi.fn().mockResolvedValue([]),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return fn(tx);
      }),
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      connectors: {
        managed: vi.fn(() => ({ complete, connectionReady })),
      },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const actor = {
      spaceId: "workspace-1",
      userId: "user-1",
      email: "user@labradoodle.test",
      isDeploymentOwner: true,
    } satisfies Actor;
    const handler = new RPCHandler(createRouter(deps));

    const response = await handle(
      handler,
      new Request("http://127.0.0.1/rpc/connections/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          json: {
            connectionId: "conn-1",
            code: "123456",
          },
        }),
      }),
      { prefix: "/rpc", context: { actor } },
    );

    expect(response.status).toBe(200);
    expect(complete).toHaveBeenCalledWith(
      { state: "gmail-state", code: "123456" },
      expect.objectContaining({ spaceId: "workspace-1", userId: "user-1" }),
    );
    expect(connectionReady).toHaveBeenCalled();
  });

  it.each(["lock", "slot"] as const)(
    "reports the row as pending without a provider call while another call holds the %s",
    async (held) => {
      vi.useFakeTimers();
      const row = {
        id: "conn-1",
        connectorId: "composio",
        provider: "gmail",
        displayName: "Gmail",
        providerRef: "gmail-state",
        status: "pending",
        createdAt: new Date("2026-08-26T00:00:00.000Z"),
      };
      const connectionReady = vi.fn().mockResolvedValue(true);
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ locked: false }]),
        connection: { findFirst: vi.fn().mockResolvedValue(row) },
      };
      const prisma = {
        connection: { findFirst: vi.fn().mockResolvedValue(row) },
        $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      } as unknown as PrismaClient;
      const handler = new RPCHandler(
        createRouter({
          prisma,
          connectors: { managed: vi.fn(() => ({ connectionReady })) },
          env: {
            defaultProvider: "fake",
            defaultModel: "fake-model",
            webOrigin: "http://127.0.0.1:5173",
            screenProxySecret: "fake-test-secret",
            sandboxProvider: "fake",
          },
          dataDir: "/tmp/labradoodle-router-test",
        } as unknown as RouterDeps),
      );
      let releaseSlot = () => {};
      const holder =
        held === "slot"
          ? runProviderTransaction(
              providerScopeKey({ spaceId: "workspace-1", userId: "user-1" }, "composio", "gmail"),
              () =>
                new Promise<void>((resolve) => {
                  releaseSlot = resolve;
                }),
              60_000,
            )
          : Promise.resolve();
      try {
        const handled = handle(
          handler,
          new Request("http://127.0.0.1/rpc/connections/complete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ json: { connectionId: "conn-1" } }),
          }),
          {
            prefix: "/rpc",
            context: {
              actor: {
                spaceId: "workspace-1",
                userId: "user-1",
                email: "user@labradoodle.test",
                isDeploymentOwner: true,
              },
            },
          },
        );
        await vi.advanceTimersByTimeAsync(2_000);
        const response = await handled;

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ json: { id: "conn-1", status: "pending" } });
        expect(connectionReady).not.toHaveBeenCalled();
        expect(prisma.$transaction).toHaveBeenCalledTimes(held === "lock" ? 1 : 0);
      } finally {
        releaseSlot();
        await holder;
        vi.useRealTimers();
      }
    },
  );

  it("completes another space's integration while a slow provider call holds its own scope", async () => {
    vi.useFakeTimers();
    // The API sizes the gate from its pool when it builds the app; the default pool is 4.
    configureProviderTransactionPool(4);
    const slowRow = {
      id: "conn-slow",
      spaceId: "space-1",
      userId: "user-1",
      connectorId: "composio",
      provider: "gmail",
      displayName: "Gmail",
      providerRef: "gmail-state",
      status: "pending",
      createdAt: new Date("2026-08-26T00:00:00.000Z"),
    };
    const otherRow = {
      id: "conn-other",
      spaceId: "space-2",
      userId: "user-2",
      connectorId: "pipedream",
      provider: "slack",
      displayName: "Slack",
      providerRef: "slack-account",
      status: "pending",
      createdAt: new Date("2026-08-26T00:00:00.000Z"),
    };
    let releaseSlowProvider = () => {};
    const slowProvider = new Promise<boolean>((resolve) => {
      releaseSlowProvider = () => resolve(true);
    });
    const otherReady = vi.fn().mockResolvedValue(true);
    const connectors = {
      managed: vi.fn((id: string) =>
        id === "composio"
          ? { connectionReady: () => slowProvider }
          : { connectionReady: otherReady },
      ),
    };
    // Each transaction reads its row, probes whether the providerRef is taken, then
    // re-reads after the update; dispatch on the probe's providerRef and per-space reads.
    const readsBySpace = new Map<string, number>();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
      connection: {
        findFirst: vi.fn(
          async ({ where }: { where: { spaceId?: string; providerRef?: string } }) => {
            if (where.providerRef) return null;
            const reads = (readsBySpace.get(where.spaceId ?? "") ?? 0) + 1;
            readsBySpace.set(where.spaceId ?? "", reads);
            const row = where.spaceId === "space-1" ? slowRow : otherRow;
            return reads === 1 ? { ...row } : { ...row, status: "connected" };
          },
        ),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      connection: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === slowRow.id ? { ...slowRow } : { ...otherRow },
        ),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    } as unknown as PrismaClient;
    const handler = new RPCHandler(
      createRouter({
        prisma,
        connectors,
        env: {
          defaultProvider: "fake",
          defaultModel: "fake-model",
          webOrigin: "http://127.0.0.1:5173",
          screenProxySecret: "fake-test-secret",
          sandboxProvider: "fake",
        },
        dataDir: "/tmp/labradoodle-router-test",
      } as unknown as RouterDeps),
    );
    const completeRequest = (connectionId: string, spaceId: string, userId: string) =>
      handle(
        handler,
        new Request("http://127.0.0.1/rpc/connections/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { connectionId } }),
        }),
        {
          prefix: "/rpc",
          context: {
            actor: { spaceId, userId, email: `${userId}@labradoodle.test`, isDeploymentOwner: true },
          },
        },
      );
    try {
      // A hanging provider call inside space-1's gated transaction pins its scope.
      const slowHandled = completeRequest(slowRow.id, "space-1", "user-1");
      await vi.advanceTimersByTimeAsync(0);
      const otherHandled = completeRequest(otherRow.id, "space-2", "user-2");
      await vi.advanceTimersByTimeAsync(2_000);
      const response = await otherHandled;

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        json: { id: "conn-other", status: "connected" },
      });
      expect(otherReady).toHaveBeenCalledWith(expect.anything(), "slack");

      releaseSlowProvider();
      const slowResponse = await slowHandled;
      expect(slowResponse.status).toBe(200);
    } finally {
      releaseSlowProvider();
      vi.useRealTimers();
    }
  });

  afterEach(() => {
    installLogger(createLogger({ service: "labradoodle-api", level: "off", sinks: [] }));
  });

  function pollFixture(status: string) {
    const row = {
      id: "conn-1",
      spaceId: "workspace-1",
      userId: "user-1",
      connectorId: "composio",
      provider: "gmail",
      displayName: "Gmail",
      providerRef: "gmail",
      status,
      createdAt: new Date("2026-08-26T00:00:00.000Z"),
    };
    const connection = {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === row.id ? { ...row } : null,
      ),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { status?: string | { in: string[] } };
          data: Partial<typeof row>;
        }) => {
          const statuses = typeof where.status === "string" ? [where.status] : where.status?.in;
          if (statuses && !statuses.includes(row.status)) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
    };
    const client = {
      connection,
      $executeRaw: vi.fn(async () => undefined),
      $queryRaw: vi.fn(async () => [{ locked: true }]),
    };
    const prisma = {
      ...client,
      $transaction: vi.fn(async (fn: (tx: typeof client) => Promise<unknown>) => fn(client)),
    } as unknown as PrismaClient;
    const connector = {
      complete: vi.fn(),
      revoke: vi.fn(),
      connectionReady: vi.fn(async () => true),
    };
    const handler = new RPCHandler(
      createRouter({
        prisma,
        connectors: { managed: () => connector },
        env: {
          defaultProvider: "fake",
          defaultModel: "fake-model",
          webOrigin: "http://127.0.0.1:5173",
          screenProxySecret: "fake-test-secret",
          sandboxProvider: "fake",
        },
      } as unknown as RouterDeps),
    );
    const sink = createTestSink();
    installLogger(createLogger({ service: "labradoodle-api", sinks: [sink] }));
    async function complete(connectionId = row.id, signal?: AbortSignal) {
      return call("complete", connectionId, signal);
    }
    async function revoke(signal?: AbortSignal) {
      return call("revoke", row.id, signal);
    }
    async function call(operation: string, connectionId: string, signal?: AbortSignal) {
      const response = await handle(
        handler,
        new Request(`http://127.0.0.1/rpc/connections/${operation}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { connectionId } }),
        }),
        {
          prefix: "/rpc",
          context: {
            actor: {
              spaceId: "workspace-1",
              userId: "user-1",
              email: "user@labradoodle.test",
              isDeploymentOwner: true,
            },
            signal,
          },
        },
      );
      return { status: response.status, body: await response.json() };
    }
    const securityEvents = () => sink.events.filter((event) => event.message === "security.event");
    return { complete, revoke, connector, connection, securityEvents, row, sink };
  }

  it.each([
    ["the caller cancelled", true, "warn"],
    ["an uncertain remote failure", false, "error"],
  ])("keeps the row revoked after %s and logs it at %s", async (_case, cancelled, level) => {
    const { revoke, connector, row, sink } = pollFixture("connected");
    row.providerRef = "account-1";
    const request = new AbortController();
    connector.revoke.mockImplementation(async () => {
      if (cancelled) request.abort();
      throw new Error("Request was cancelled by the caller: Request was aborted.");
    });

    await expect(revoke(request.signal)).resolves.toMatchObject({ status: 400 });
    expect(row.status).toBe("revoked");
    expect(
      sink.events
        .filter((event) => event.message.startsWith("connections.revoke"))
        .map((event) => event.level),
    ).toEqual([level]);
  });

  it("records nothing but keeps the account id when the catalog connected the row first", async () => {
    const { complete, connector, securityEvents, row } = pollFixture("pending");
    // The catalog flips the row while complete is checking with the provider.
    connector.connectionReady.mockImplementation(async () => {
      row.status = "connected";
      return true;
    });
    Object.assign(connector, { resolveConnectedAccountId: vi.fn(async () => "account-1") });

    await expect(complete()).resolves.toMatchObject({ body: { json: { status: "connected" } } });
    expect(row.providerRef).toBe("account-1");
    expect(securityEvents()).toEqual([]);
  });

  it("stores the account id on a poll after the catalog connected the row", async () => {
    const { complete, connector, securityEvents, row } = pollFixture("connected");
    Object.assign(connector, { resolveConnectedAccountId: vi.fn(async () => "account-1") });

    await expect(complete()).resolves.toMatchObject({ body: { json: { status: "connected" } } });
    expect(row.providerRef).toBe("account-1");
    expect(connector.complete).not.toHaveBeenCalled();
    expect(securityEvents()).toEqual([]);
  });

  it("keeps the app-only ref while a sibling authorization for the same app is unresolved", async () => {
    const { complete, connector, connection, row } = pollFixture("connected");
    connection.findMany.mockResolvedValue([{ providerRef: "gmail", status: "pending" }] as never);
    Object.assign(connector, { resolveConnectedAccountId: vi.fn(async () => "account-2") });

    await expect(complete()).resolves.toMatchObject({ body: { json: { status: "connected" } } });
    expect(row.providerRef).toBe("gmail");
  });

  it("stores the account id beside an abandoned sibling attempt", async () => {
    const { complete, connector, connection, row } = pollFixture("connected");
    connection.findMany.mockResolvedValue([{ providerRef: null, status: "error" }] as never);
    Object.assign(connector, { resolveConnectedAccountId: vi.fn(async () => "account-1") });

    await expect(complete()).resolves.toMatchObject({ body: { json: { status: "connected" } } });
    expect(row.providerRef).toBe("account-1");
  });

  it("stores the connected account a request id resolves to", async () => {
    const { complete, connector, row } = pollFixture("pending");
    row.providerRef = "request-1";
    Object.assign(connector, {
      accounts: new Map([["request-1", "account-1"]]),
      async resolveConnectedAccountId(
        this: { accounts: Map<string, string> },
        _userId: string,
        _slug: string,
        ref: string,
      ) {
        return this.accounts.get(ref);
      },
    });

    await expect(complete()).resolves.toMatchObject({ body: { json: { status: "connected" } } });
    expect(row.providerRef).toBe("account-1");
  });

  it("reports a superseded connection as revoked instead of failing", async () => {
    const { complete, connector, securityEvents } = pollFixture("revoked");

    await expect(complete()).resolves.toMatchObject({
      status: 200,
      body: { json: { id: "conn-1", status: "revoked" } },
    });
    expect(connector.connectionReady).not.toHaveBeenCalled();
    expect(securityEvents()).toEqual([]);
  });

  it("finishes removing a superseded remote after the poll that triggered it is aborted", async () => {
    const { complete, connector, row } = pollFixture("revoked");
    row.providerRef = "request-1";
    const poll = new AbortController();
    poll.abort();

    await expect(complete(row.id, poll.signal)).resolves.toMatchObject({
      body: { json: { status: "revoked" } },
    });
    expect(connector.revoke).toHaveBeenCalledWith(
      "request-1",
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
  });

  it("records one credential event per connection, not per poll", async () => {
    const { complete, securityEvents } = pollFixture("pending");

    for (let poll = 0; poll < 3; poll += 1) {
      await expect(complete()).resolves.toMatchObject({
        status: 200,
        body: { json: { status: "connected" } },
      });
    }
    expect(securityEvents()).toHaveLength(1);
    expect(securityEvents()[0]).toMatchObject({
      "security.event.type": "credential.created",
      "security.event.metadata": {
        procedure: "connections.complete",
        kind: "connection",
        connectionId: "conn-1",
      },
    });
  });

  it("records the credential once when the catalog finds the app connected", async () => {
    const row = { id: "conn-1", provider: "gmail", displayName: "Gmail", status: "pending" };
    const connection = {
      findMany: vi.fn(async () => [{ ...row }]),
      updateMany: vi.fn(async ({ where }: { where: { id?: string; status: string } }) => {
        if (where.id !== row.id || row.status !== where.status) return { count: 0 };
        row.status = "connected";
        return { count: 1 };
      }),
    };
    const prisma = {
      connection,
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ connection })),
    } as unknown as PrismaClient;
    const provider = {
      describe: () => ({ id: "composio" }),
      catalog: vi.fn(async () => [
        {
          connectorId: "composio",
          slug: "gmail",
          name: "Gmail",
          logo: null,
          connected: true,
          noAuth: false,
        },
      ]),
    };
    const client = createRouterClient(
      createRouter({
        prisma,
        connectors: { managed: () => provider },
        env: {
          defaultProvider: "fake",
          defaultModel: "fake-model",
          webOrigin: "http://127.0.0.1:5173",
          screenProxySecret: "fake-test-secret",
          sandboxProvider: "fake",
        },
      } as unknown as RouterDeps),
      {
        context: {
          actor: {
            spaceId: "workspace-1",
            userId: "user-1",
            email: "user@labradoodle.test",
            isDeploymentOwner: true,
          },
        } as never,
      },
    );
    const sink = createTestSink();
    installLogger(createLogger({ service: "labradoodle-api", sinks: [sink] }));

    await client.connections.catalog({ connectorId: "composio" });
    await client.connections.catalog({ connectorId: "composio" });

    const events = sink.events.filter((event) => event.message === "security.event");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      "security.event.type": "credential.created",
      "security.event.metadata": { procedure: "connections.catalog", connectionId: "conn-1" },
    });
  });

  it("records nothing while the connection is still pending", async () => {
    const { complete, connector, securityEvents } = pollFixture("pending");
    connector.connectionReady.mockResolvedValue(false);

    await expect(complete()).resolves.toMatchObject({ body: { json: { status: "pending" } } });
    expect(securityEvents()).toEqual([]);
  });
});

describe("updater owner gate", () => {
  function updaterDeps() {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          email: "user@labradoodle.test",
          name: "Test User",
          avatarStyle: "robot",
          secrets: [],
        }),
      },
      userModelPreference: { findFirst: vi.fn().mockResolvedValue(null) },
      deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
        gitSha: "deadbeef",
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    return { deps, handler: new RPCHandler(createRouter(deps)) };
  }

  it("forbids non-owners from updater status", async () => {
    const { handler } = updaterDeps();
    const actor = {
      spaceId: "workspace-1",
      userId: "user-2",
      email: "member@labradoodle.test",
      isDeploymentOwner: false,
    } satisfies Actor;

    const response = await handle(
      handler,
      new Request("http://127.0.0.1/rpc/updater/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: null }),
      }),
      { prefix: "/rpc", context: { actor } },
    );

    expect(response.status).toBe(403);
  });

  it("denies a legacy owner server update status", async () => {
    const { handler } = updaterDeps();
    const actor = {
      spaceId: "workspace-1",
      userId: "user-1",
      email: "owner@labradoodle.test",
      isDeploymentOwner: true,
    } satisfies Actor;

    const response = await handle(
      handler,
      new Request("http://127.0.0.1/rpc/updater/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: null }),
      }),
      { prefix: "/rpc", context: { actor } },
    );

    expect(response.status).toBe(403);
  });

  it("refuses apply when the sidecar is not configured", async () => {
    const { handler } = updaterDeps();
    const actor = {
      spaceId: "workspace-1",
      userId: "user-1",
      email: "owner@labradoodle.test",
      isDeploymentOwner: true,
    } satisfies Actor;

    const response = await handle(
      handler,
      new Request("http://127.0.0.1/rpc/updater/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: {} }),
      }),
      { prefix: "/rpc", context: { actor } },
    );

    expect(response.status).toBe(403);
  });
});

describe("computer screen url", () => {
  const actor = {
    spaceId: "workspace-1",
    userId: "user-1",
    email: "user@labradoodle.test",
    isDeploymentOwner: true,
  } satisfies Actor;
  const computerRow = {
    id: "computer-1",
    screenGeneration: 3,
    kind: "e2b",
    scope: "team",
    state: "running",
    providerRef: "sandbox-ref-1",
    homeKey: "home-1",
    controlHolder: "none",
    controlLeaseId: null,
    controlLeaseExpiresAt: null,
    controlBotId: null,
    controlRunId: null,
  };

  const callScreenUrl = async (
    connectScreen: () => Promise<unknown>,
    updateMany = vi.fn().mockResolvedValue({ count: 1 }),
  ) => {
    const endRun = vi.fn().mockResolvedValue(1);
    const prisma = {
      bot: {
        findFirst: vi.fn().mockResolvedValue({
          id: "bot-1",
          screenGeneration: 2,
          thread: { id: "thread-1" },
          computer: computerRow,
        }),
      },
      computer: { updateMany },
      $executeRaw: endRun,
      computerExecutionLease: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      sandbox: { connectScreen },
      jobs: { enqueue: vi.fn().mockResolvedValue(undefined) },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "e2b",
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));
    const response = await handle(
      handler,
      new Request("http://127.0.0.1/rpc/computer/screenUrl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { botId: "bot-1" } }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    return { response, updateMany, endRun };
  };

  it("keeps a transport blip an error and leaves the row alone", async () => {
    const { response, updateMany } = await callScreenUrl(() =>
      Promise.reject(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })),
    );
    expect(response.status).toBe(500);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("computer terminal and file transfer", () => {
  const actor = {
    spaceId: "workspace-1",
    userId: "user-1",
    email: "user@labradoodle.test",
    isDeploymentOwner: true,
  } satisfies Actor;

  function setup(computer: Record<string, unknown> = {}, maxUploadSizeBytes?: number) {
    const sandbox = {
      execute: vi.fn(async function* () {
        yield { type: "exit" as const, code: 0 };
      }),
      listFiles: vi.fn().mockResolvedValue([]),
      connectTerminal: vi.fn().mockResolvedValue({
        url: "https://screen.example/vnc.html?path=websockify%3Ftoken%3Dterminal-1",
      }),
      readFile: vi.fn().mockResolvedValue(new TextEncoder().encode("hello")),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };
    const prisma = {
      spaceMember: { count: vi.fn(async () => 1) },
      bot: {
        findFirst: vi.fn().mockResolvedValue({
          id: "bot-1",
          screenGeneration: 2,
          thread: { id: "thread-1" },
          computer: {
            id: "computer-1",
            screenGeneration: 3,
            kind: "docker",
            scope: "team",
            state: "running",
            providerRef: "sandbox-ref-1",
            homeKey: "home-1",
            controlHolder: "none",
            controlLeaseId: null,
            controlLeaseExpiresAt: null,
            controlBotId: null,
            controlRunId: null,
            ...computer,
          },
        }),
      },
      computer: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      computerExecutionLease: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const deps = {
      prisma,
      sandbox,
      jobs: { enqueue: vi.fn().mockResolvedValue(undefined) },
      env: {
        maxUploadSizeBytes,
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "docker",
      },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));
    const call = async (procedure: string, json: Record<string, unknown>) => {
      const response = await handle(
        handler,
        new Request(`http://127.0.0.1/rpc/computer/${procedure}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { botId: "bot-1", ...json } }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
      return { status: response.status, body: await response.json() };
    };
    return { sandbox, prisma, call };
  }

  it("does not discard a live sandbox when folder preparation fails", async () => {
    const { sandbox, prisma, call } = setup();
    sandbox.execute.mockImplementation(async function* () {
      yield { type: "exit" as const, code: 1 };
    });
    await expect(call("boot", {})).resolves.toMatchObject({ status: 500 });
    expect(prisma.computer.updateMany).not.toHaveBeenCalled();
  });
});

describe("integration setup authorization", () => {
  it.each([
    { owner: false, configured: false, needsSetup: false },
    { owner: true, configured: false, needsSetup: false },
    { owner: true, configured: true, needsSetup: false },
  ])(
    "never offers server setup to an app account: %j",
    async ({ owner, configured, needsSetup }) => {
      const lookup = vi.fn(async () => configured);
      const deps = {
        prisma: {},
        env: { webOrigin: "https://example.test" },
        integrationSettings: { configured: lookup },
      } as unknown as RouterDeps;
      const handler = new RPCHandler(createRouter(deps));
      const response = await handle(
        handler,
        new Request("https://example.test/rpc/integrationSetup/get", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: null }),
        }),
        {
          prefix: "/rpc",
          context: {
            actor: {
              userId: "user",
              spaceId: "space",
              email: "user@labradoodle.test",
              isDeploymentOwner: owner,
            },
          },
        },
      );
      const result = (await response.json()).json;
      expect(result).toMatchObject({ canConfigure: false, needsSetup });
      expect(result.providers).toEqual([]);
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it("rejects provider credentials from a non-owner before verification or persistence", async () => {
    const save = vi.fn();
    const deps = {
      prisma: {},
      env: { webOrigin: "https://example.test" },
      integrationSettings: { save },
    } as unknown as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));
    const response = await handle(
      handler,
      new Request("https://example.test/rpc/integrationSetup/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { provider: "composio", apiKey: "fake-key" } }),
      }),
      {
        prefix: "/rpc",
        context: {
          actor: {
            userId: "member",
            spaceId: "space",
            email: "member@labradoodle.test",
            isDeploymentOwner: false,
          },
        },
      },
    );
    expect(response.status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });
});

describe("server operation authorization", () => {
  it.each([false, true])(
    "rejects server administration even with legacy owner flag %s",
    async (isDeploymentOwner) => {
      const prisma = { deploymentSettings: { update: vi.fn() }, $transaction: vi.fn() };
      const client = createRouterClient(
        createRouter({
          prisma,
          env: { webOrigin: "https://example.test" },
        } as unknown as RouterDeps),
        {
          context: {
            actor: {
              userId: "user",
              spaceId: "space",
              email: "user@example.test",
              isDeploymentOwner,
            },
          } as never,
        },
      );
      for (const call of [
        () => client.deployment.get(),
        () => client.deployment.update({ signupsEnabled: true }),
        () => client.security.events({}),
        () => client.updater.status(),
        () => client.updater.check({}),
        () => client.updater.apply({}),
        () => client.computer.releaseInterrupted({ id: "update-1", workersStopped: true }),
        () => client.integrationSetup.save({ provider: "composio", apiKey: "fake-key" }),
      ])
        await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(prisma.deploymentSettings.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});

describe("OpenAI-compatible model probes", () => {
  const actor = {
    spaceId: "workspace-1",
    userId: "user-1",
    email: "user@labradoodle.test",
    isDeploymentOwner: true,
  } satisfies Actor;
  const baseUrl = "https://127.0.0.1:8000/v1";
  const stored = JSON.stringify({ kind: "openai_compatible", baseUrl, apiKey: "fake-saved-key" });

  function fixture(
    options: {
      credentialUserId?: string;
      secretUserId?: string;
      actor?: Actor;
      mcpAllowPrivateEndpoint?: boolean;
    } = {},
  ) {
    const credential = {
      id: "cred-1",
      userId: options.credentialUserId ?? actor.userId,
      provider: "openai-compatible",
      secretId: "secret-1",
    };
    const credentials = [credential];
    const findCredential = vi.fn(
      async ({ where }: { where: { userId: string; provider: string } }) =>
        where.userId === credential.userId && where.provider === credential.provider
          ? credential
          : null,
    );
    const findCredentials = vi.fn(
      async ({ where }: { where: { userId: string; provider: string } }) =>
        credentials.filter(
          (candidate) => candidate.userId === where.userId && candidate.provider === where.provider,
        ),
    );
    const findSecret = vi.fn(
      async ({ where }: { where: { userId: string; id: { in: string[] }; spaceId: null } }) =>
        credentials
          .filter(
            (candidate) =>
              where.userId === (options.secretUserId ?? candidate.userId) &&
              where.id.in.includes(candidate.secretId) &&
              where.spaceId === null,
          )
          .map((candidate) => ({ id: candidate.secretId, ciphertext: "fake-ciphertext" })),
    );
    const load = vi.fn().mockResolvedValue(stored);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ data: [{ id: "test-model" }] }),
    );
    const probe = adapters.probeOpenAiCompatibleModels;
    vi.spyOn(adapters, "probeOpenAiCompatibleModels").mockImplementation((input, _, signal, opts) =>
      probe(input, fetch, signal, opts),
    );
    const deps = {
      prisma: {
        userModelPreference: { findFirst: vi.fn().mockResolvedValue(null) },
        userModelCredential: { findFirst: findCredential, findMany: findCredentials },
        secret: { findMany: findSecret },
      },
      secrets: { load },
      modelConnectionFetch: vi.fn(() => {
        throw new Error("Unexpected injected transport");
      }),
      env: {
        sandboxProvider: "fake",
        mcpAllowPrivateEndpoint: options.mcpAllowPrivateEndpoint ?? true,
      },
    } as unknown as RouterDeps;
    const client = createRouterClient(createRouter(deps), {
      context: { actor: options.actor ?? actor } as never,
    });
    return { client, fetch, credentials, findCredential, findCredentials, findSecret, load };
  }

  afterEach(() => vi.restoreAllMocks());

  it("does not inject the connection transport into non-Ollama probes", async () => {
    const { client } = fixture();
    await client.models.probeOpenAiCompatible({ baseUrl });
    expect(adapters.probeOpenAiCompatibleModels).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      undefined,
      expect.anything(),
    );
  });

  it.each([undefined, "", "   "])("uses the saved key for a blank key %j", async (apiKey) => {
    const { client, fetch, findSecret, load } = fixture();
    const response = await client.models.probeOpenAiCompatible({ baseUrl, apiKey });
    expect(fetch).toHaveBeenCalledWith(
      new URL(`${baseUrl}/models`),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer fake-saved-key" }),
      }),
    );
    expect(findSecret).toHaveBeenCalledWith({
      where: { id: { in: ["secret-1"] }, userId: actor.userId, spaceId: null },
      select: { id: true, ciphertext: true },
    });
    expect(load).toHaveBeenCalledWith("fake-ciphertext", "secret-1");
    expect(response).toEqual({ models: ["test-model"] });
    expect(JSON.stringify(response)).not.toContain("fake-saved-key");
  });

  it("uses explicit key and headers without looking up the stored credential", async () => {
    const { client, fetch, findCredential, findCredentials, findSecret, load } = fixture();
    await client.models.probeOpenAiCompatible({ baseUrl, apiKey: " fake-typed-key ", headers: {} });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer fake-typed-key" }),
      }),
    );
    expect(findCredential).not.toHaveBeenCalled();
    expect(findCredentials).not.toHaveBeenCalled();
    expect(findSecret).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("reuses saved headers for the same endpoint without exposing them", async () => {
    const { client, fetch, load } = fixture();
    load.mockResolvedValue(
      JSON.stringify({
        kind: "openai_compatible",
        baseUrl,
        apiKey: "fake-saved-key",
        headers: { "x-session": "fake-session-secret" },
      }),
    );
    const response = await client.models.probeOpenAiCompatible({ baseUrl });
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("x-session")).toBe(
      "fake-session-secret",
    );
    expect(JSON.stringify(response)).not.toContain("fake-session-secret");
  });

  it("sends a saved key with Anthropic headers for the Anthropic Messages protocol", async () => {
    const { client, fetch, load } = fixture();
    load.mockResolvedValue(
      JSON.stringify({ kind: "openai_compatible", baseUrl, apiKey: "fake-saved-key" }),
    );
    const response = await client.models.probeOpenAiCompatible({
      baseUrl,
      apiProtocol: "anthropic-messages",
    });
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-api-key")).toBe("fake-saved-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("authorization")).toBeNull();
    expect(response).toEqual({ models: ["test-model"] });
  });

  it("never uses another user's credential id for probe secrets", async () => {
    const { client, fetch, credentials, load } = fixture();
    credentials.push({
      id: "other-credential",
      userId: "other-user",
      provider: "openai-compatible",
      secretId: "other-secret",
    });
    await client.models.probeOpenAiCompatible({ baseUrl, credentialId: "other-credential" });
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("x-session")).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it("takes both saved fields from the selected credential, never another credential", async () => {
    const { client, fetch, credentials, load } = fixture();
    credentials.push({
      id: "cred-2",
      userId: actor.userId,
      provider: "openai-compatible",
      secretId: "secret-2",
    });
    load.mockImplementation(async (_, secretId) =>
      JSON.stringify({
        kind: "openai_compatible",
        baseUrl,
        apiKey: secretId === "secret-2" ? "selected-key" : "other-key",
        headers: secretId === "secret-2" ? {} : { "x-session": "other-session" },
      }),
    );
    await client.models.probeOpenAiCompatible({ baseUrl, credentialId: "cred-2" });
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer selected-key");
    expect(headers.has("x-session")).toBe(false);
    expect(load.mock.calls.map((call) => call[1])).toEqual(["secret-2"]);
  });

  it.each(["different endpoint", "unreadable", "matching endpoint"])(
    "tries the preferred credential first, then another matching credential when preferred is %s",
    async (preferred) => {
      const { client, fetch, credentials, findCredentials, findSecret, load } = fixture();
      credentials.push({
        id: "cred-2",
        userId: actor.userId,
        provider: "openai-compatible",
        secretId: "secret-2",
      });
      load.mockImplementation(async (_, secretId) => {
        if (secretId === "secret-2") return stored;
        if (preferred === "unreadable") throw new Error("Secret unavailable");
        return JSON.stringify({
          kind: "openai_compatible",
          baseUrl: preferred === "matching endpoint" ? baseUrl : "https://127.0.0.2:8000/v1",
          apiKey: "fake-preferred-key",
        });
      });

      await client.models.probeOpenAiCompatible({ baseUrl });

      expect(findCredentials).toHaveBeenCalledWith({
        where: { userId: actor.userId, provider: "openai-compatible" },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      });
      expect(findSecret).toHaveBeenCalledExactlyOnceWith({
        where: { id: { in: ["secret-1", "secret-2"] }, userId: actor.userId, spaceId: null },
        select: { id: true, ciphertext: true },
      });
      expect(fetch.mock.calls[0]?.[1]?.headers).toHaveProperty(
        "Authorization",
        preferred === "matching endpoint" ? "Bearer fake-preferred-key" : "Bearer fake-saved-key",
      );
      expect(load.mock.calls.map((call) => call[1])).toEqual(
        preferred === "matching endpoint" ? ["secret-1"] : ["secret-1", "secret-2"],
      );
    },
  );

  it("never uses another user's matching credential after the preferred endpoint differs", async () => {
    const { client, fetch, credentials, findSecret, load } = fixture();
    credentials.push({
      id: "cred-other",
      userId: "other-user",
      provider: "openai-compatible",
      secretId: "secret-other",
    });
    load.mockImplementation(async (_, secretId) =>
      secretId === "secret-other"
        ? stored
        : JSON.stringify({
            kind: "openai_compatible",
            baseUrl: "https://127.0.0.2:8000/v1",
            apiKey: "fake-preferred-key",
          }),
    );

    await client.models.probeOpenAiCompatible({ baseUrl });

    expect(findSecret).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ["secret-1"] }, userId: actor.userId, spaceId: null },
      select: { id: true, ciphertext: true },
    });
    expect(load).toHaveBeenCalledExactlyOnceWith("fake-ciphertext", "secret-1");
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
  });

  it("does not send the saved key to a different endpoint", async () => {
    const { client, fetch } = fixture();
    await client.models.probeOpenAiCompatible({ baseUrl: "https://127.0.0.2:8000/v1" });
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
  });

  it.each([{ credentialUserId: "other-user" }, { secretUserId: "other-user" }])(
    "does not load another user's credential or secret: %j",
    async (options) => {
      const { client, fetch, findCredential, load } = fixture(options);
      await client.models.probeOpenAiCompatible({ baseUrl });
      expect(findCredential).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: actor.userId, provider: "openai-compatible" } }),
      );
      expect(load).not.toHaveBeenCalled();
      expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
    },
  );

  it.each(["unavailable", "corrupt"])(
    "falls back when the stored secret is %s",
    async (failure) => {
      const { client, fetch, load } = fixture();
      if (failure === "unavailable") load.mockRejectedValue(new Error("Secret unavailable"));
      else load.mockResolvedValue('{"kind":"openai_compatible"}');
      await expect(client.models.probeOpenAiCompatible({ baseUrl })).resolves.toEqual({
        models: ["test-model"],
      });
      expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty("Authorization");
    },
  );

  it("refuses a private endpoint probe from a user who is not the deployment owner", async () => {
    const { client, fetch } = fixture({
      actor: { ...actor, isDeploymentOwner: true },
      mcpAllowPrivateEndpoint: false,
    });
    await expect(
      client.models.probeOpenAiCompatible({ baseUrl, apiKey: "fake-typed-key" }),
    ).rejects.toThrow(adapters.PRIVATE_MODEL_ENDPOINT_MESSAGE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("probes a private endpoint for any user when the instance flag allows it", async () => {
    const { client, fetch } = fixture({
      actor: { ...actor, isDeploymentOwner: false },
      mcpAllowPrivateEndpoint: true,
    });
    await expect(
      client.models.probeOpenAiCompatible({ baseUrl, apiKey: "fake-typed-key" }),
    ).resolves.toEqual({ models: ["test-model"] });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("still rejects saved keys on public HTTP endpoints", async () => {
    vi.stubEnv("LABRADOODLE_OPENAI_COMPAT_ALLOW_PUBLIC", "1");
    try {
      const { client, fetch, load } = fixture();
      const baseUrl = "http://example.invalid/v1";
      load.mockResolvedValue(
        JSON.stringify({ kind: "openai_compatible", baseUrl, apiKey: "fake-saved-key" }),
      );
      await expect(client.models.probeOpenAiCompatible({ baseUrl })).rejects.toThrow(/HTTPS/);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("model credential persistence", () => {
  const actor = {
    spaceId: "workspace-1",
    userId: "user-1",
    email: "user@labradoodle.test",
    isDeploymentOwner: true,
  } satisfies Actor;

  function persistDeps(options?: {
    envDefaultModel?: string;
    deploymentModelConfigured?: boolean;
  }) {
    const upsert = vi.fn(async (_args: unknown) => ({ id: "preference" }));
    const finish = vi.fn();
    // Connect loads any previous credential on the root client before the write transaction.
    const userModelCredential = {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(async ({ data }: { data: { provider: string } }) => ({
        id: "cred-1",
        userId: actor.userId,
        provider: data.provider,
        label: data.provider,
        secretId: "secret-1",
        supportsImages: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })),
    };
    const userModelPreference = {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert,
    };
    const tx = {
      userModelCredential,
      secret: { create: vi.fn().mockResolvedValue({}) },
      userModelPreference,
    };
    const deps = {
      prisma: {
        userModelCredential,
        userModelPreference,
        deploymentSettings: { findUnique: vi.fn().mockResolvedValue(null) },
        $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      },
      secrets: {
        put: vi.fn().mockResolvedValue({ id: "secret-1", ciphertext: "cipher" }),
      },
      oauthLogins: {
        finish,
      },
      env: {
        defaultProvider: "openrouter",
        defaultModel: options?.envDefaultModel ?? "openai/gpt-5.6-luna",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
        agentRuntime: "pi",
        deploymentModelConfigured: options?.deploymentModelConfigured ?? false,
      },
    } as unknown as RouterDeps;
    return { upsert, finish, deps, handler: new RPCHandler(createRouter(deps)) };
  }

  async function call(
    handler: RouterHandler,
    path: string,
    body: unknown,
    as: Actor = actor,
  ): Promise<Response> {
    const response = await handle(
      handler,
      new Request(`http://127.0.0.1/rpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: body }),
      }),
      { prefix: "/rpc", context: { actor: as } },
    );
    return response;
  }

  const privateConnect = {
    provider: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    modelId: "local-model",
  };

  it("refuses to save a private model endpoint for a user who is not the deployment owner", async () => {
    const { deps, handler } = persistDeps();
    const response = await call(handler, "models/connect", privateConnect, {
      ...actor,
      isDeploymentOwner: false,
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      json: { message: adapters.PRIVATE_MODEL_ENDPOINT_MESSAGE },
    });
    expect(deps.secrets.put).not.toHaveBeenCalled();
  });

  it.each([
    { isDeploymentOwner: true, mcpAllowPrivateEndpoint: true },
    { isDeploymentOwner: false, mcpAllowPrivateEndpoint: true },
  ])("lets a private model endpoint through for %j", async (who) => {
    const { deps, handler } = persistDeps();
    Object.assign(deps.env, { mcpAllowPrivateEndpoint: who.mcpAllowPrivateEndpoint });
    const build = vi.spyOn(adapters, "buildModelConnectPlaintext").mockImplementation(() => {
      throw new Error("stop after validation");
    });
    try {
      await call(handler, "models/connect", privateConnect, {
        ...actor,
        isDeploymentOwner: who.isDeploymentOwner,
      });
      expect(build).toHaveBeenCalledWith(
        expect.objectContaining({ baseUrl: privateConnect.baseUrl }),
        undefined,
        expect.objectContaining({ allowPrivateEndpoint: true }),
      );
    } finally {
      build.mockRestore();
    }
  });

  it("does not persist a stringified null model id from subscription sign-in", async () => {
    const { upsert, finish, handler } = persistDeps();
    finish.mockImplementation(async (_loginId, _actor, persist) => ({
      status: "connected" as const,
      value: await persist({
        status: "connected",
        provider: "anthropic",
        modelId: "null",
        label: "Anthropic",
        credential: {
          type: "oauth",
          access: "access-token",
          refresh: "refresh-token",
          expires: Date.now() + 60_000,
        },
        signal: new AbortController().signal,
      }),
    }));

    const response = await call(handler, "models/finishOAuth", { loginId: "login-1" });
    expect(response.status).toBe(200);
    const persisted = upsert.mock.calls[0]?.[0] as {
      create: { modelId: string | null };
      update: { modelId: string | null };
    };
    expect(persisted.create.modelId).not.toBe("null");
    expect(persisted.create.modelId).toBeTruthy();
    expect(persisted.update.modelId).toBe(persisted.create.modelId);
    await expect(response.json()).resolves.toEqual({
      json: expect.objectContaining({
        provider: "anthropic",
        modelId: persisted.create.modelId,
      }),
    });
  });

  it("updates a saved legacy Azure credential when replacing its key", async () => {
    const { deps, handler } = persistDeps();
    const existing = {
      id: "cred-azure",
      userId: actor.userId,
      provider: "azure-openai-responses",
      label: "Azure",
      secretId: "old-secret",
    };
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...existing,
      ...data,
    }));
    const findFirst = vi.fn(
      async ({ where }: { where: { provider: string | { in: string[] } } }) => {
        const provider = where.provider;
        return provider === existing.provider ||
          (typeof provider !== "string" && provider.in.includes(existing.provider))
          ? existing
          : null;
      },
    );
    Object.assign(deps.prisma.userModelCredential, {
      findFirst,
      update,
      count: vi.fn().mockResolvedValue(0),
    });
    // The fixture shares this client with the write transaction.
    const transaction = deps.prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
    transaction.mockImplementation(async (fn) =>
      fn(
        withModelRoles({
          userModelCredential: deps.prisma.userModelCredential,
          userVoiceCredential: { count: vi.fn().mockResolvedValue(0) },
          userModelPreference: deps.prisma.userModelPreference,
          secret: {
            create: vi.fn().mockResolvedValue({ id: "new-secret" }),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        }),
      ),
    );
    Object.assign(deps.prisma, {
      secret: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    const response = await call(handler, "models/connect", {
      provider: "azure",
      apiKey: "fake-replacement-key",
      modelId: "gpt-4o",
    });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: existing.id },
      // An older app's connect replaces the provider's connection and keeps its name.
      data: { secretId: "new-secret" },
    });
    expect(deps.prisma.userModelCredential.create).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      json: { id: existing.id, provider: "azure" },
    });
  });

  it("keeps another connection as the space default when makeDefault is false", async () => {
    const { upsert, deps, handler } = persistDeps();
    const preferences = deps.prisma.userModelPreference as unknown as {
      findFirst: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    // Another connection runs the main model.
    await (
      deps.prisma.userModelRoleChoice as unknown as {
        createMany: (args: { data: unknown[] }) => Promise<unknown>;
      }
    ).createMany({
      data: [mainRole({ userId: actor.userId }, "other-provider", "other-model")],
    });

    const response = await call(handler, "models/connect", {
      provider: "test-provider",
      apiKey: "sk-test-key-123",
      modelId: "fallback-model",
      makeDefault: false,
    });

    expect(response.status).toBe(200);
    expect(preferences.updateMany).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { modelId: "fallback-model", thinkingLevel: null },
      }),
    );
    await expect(response.json()).resolves.toMatchObject({ json: { isDefault: false } });
  });

  it("keeps a working deployment model when a fallback connection is added", async () => {
    const { upsert, handler } = persistDeps({ deploymentModelConfigured: true });

    const response = await call(handler, "models/connect", {
      provider: "test-provider",
      apiKey: "sk-test-key-123",
      modelId: "fallback-model",
      makeDefault: false,
    });

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ modelId: "fallback-model" }) }),
    );
    await expect(response.json()).resolves.toMatchObject({ json: { isDefault: false } });
  });

  it("leaves the main model's choice alone when its own connection is saved for another role", async () => {
    const { upsert, handler } = persistDeps({ deploymentModelConfigured: true });
    // This connection already runs chat.
    const chat = await call(handler, "models/connect", {
      provider: "test-provider",
      apiKey: "sk-test-key-123",
      modelId: "chat-model",
      makeDefault: true,
    });
    expect(chat.status).toBe(200);
    upsert.mockClear();

    const response = await call(handler, "models/connect", {
      provider: "test-provider",
      apiKey: "sk-test-key-123",
      modelId: "approval-model",
      makeDefault: false,
    });

    expect(response.status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ json: { isDefault: true } });
  });

  it("changes no model role for a first connection when makeDefault is false", async () => {
    const { upsert, deps, handler } = persistDeps();

    const response = await call(handler, "models/connect", {
      provider: "test-provider",
      apiKey: "sk-test-key-123",
      modelId: "only-model",
      makeDefault: false,
    });

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ modelId: "only-model" }) }),
    );
    const roles = deps.prisma.userModelRoleChoice as unknown as {
      createMany: ReturnType<typeof vi.fn>;
    };
    expect(roles.createMany).not.toHaveBeenCalled();
  });

  it("makes the connection's model the main model when asked, through the role table", async () => {
    const { upsert, deps, handler } = persistDeps();

    const response = await call(handler, "models/connect", {
      provider: "test-provider",
      apiKey: "sk-test-key-123",
      modelId: "only-model",
      makeDefault: true,
    });

    expect(response.status).toBe(200);
    const roles = deps.prisma.userModelRoleChoice as unknown as {
      createMany: ReturnType<typeof vi.fn>;
    };
    expect(roles.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          role: "main",
          position: 0,
          provider: "test-provider",
          modelId: "only-model",
        }),
      ],
    });
    // The connection's own model is the one it connected with.
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { modelId: "only-model", thinkingLevel: null } }),
    );
    await expect(response.json()).resolves.toMatchObject({ json: { isDefault: true } });
  });

  it("does not persist a missing model id as the string null", async () => {
    const { upsert, handler } = persistDeps({ envDefaultModel: "null" });

    const response = await call(handler, "models/connect", {
      provider: "test-provider",
      apiKey: "sk-test-key-123",
      modelId: undefined,
    });
    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ modelId: null }),
        update: expect.objectContaining({ modelId: null }),
      }),
    );
  });

  it.each([401, 403, 503])(
    "rejects an unverified compatible Ollama connection (%i) before saving",
    async (status) => {
      const { deps, handler } = persistDeps();
      const transport = vi.fn<typeof fetch>(async () => new Response(null, { status }));
      Object.assign(deps, { modelConnectionFetch: transport });
      const response = await call(handler, "models/connect", {
        provider: "openai-compatible",
        baseUrl: "https://ollama.com/v1",
        apiKey: "fake-fixture-key",
        modelId: "fixture-model",
      });
      expect(response.status).toBe(400);
      expect(String(transport.mock.calls[0]?.[0])).toBe("https://ollama.com/api/balance");
      expect(deps.secrets.put).not.toHaveBeenCalled();
      expect(deps.prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each(
    ["openrouter", "google", "deepseek"].flatMap((provider) =>
      [401, 403].map((status) => ({ provider, status })),
    ),
  )(
    "rejects a refused $provider replacement ($status) without changing the saved connection",
    async ({ provider, status }) => {
      const { upsert, deps, handler } = persistDeps();
      const saved = {
        id: "credential-fixture",
        userId: actor.userId,
        provider,
        secretId: "secret-fixture",
      };
      vi.mocked(deps.prisma.userModelCredential.findFirst).mockResolvedValue(saved as never);
      Object.assign(deps.prisma, {
        secret: { findFirst: vi.fn().mockResolvedValue({ ciphertext: "fixture-ciphertext" }) },
      });
      Object.assign(deps.secrets, { load: vi.fn().mockResolvedValue("fixture-previous-key") });
      const fetchImpl = vi.fn<typeof fetch>(
        async () => new Response("private upstream details", { status }),
      );
      vi.stubGlobal("fetch", fetchImpl);
      try {
        const response = await call(handler, "models/connect", {
          provider,
          apiKey: "fixture-replacement-key",
        });
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          json: {
            code: "BAD_REQUEST",
            message: "API key was rejected by the provider.",
          },
        });
        expect(fetchImpl).toHaveBeenCalledOnce();
        expect(deps.secrets.put).not.toHaveBeenCalled();
        expect(deps.prisma.$transaction).not.toHaveBeenCalled();
        expect(upsert).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it.each([
    {
      provider: "openrouter",
      url: "https://openrouter.ai/api/v1/key",
      headers: { Authorization: "Bearer fixture-key" },
    },
    {
      provider: "deepseek",
      url: "https://api.deepseek.com/models",
      headers: { Authorization: "Bearer fixture-key" },
    },
    {
      provider: "google",
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      headers: { "x-goog-api-key": "fixture-key" },
    },
  ])(
    "saves a $provider key only after its authentication check succeeds",
    async ({ provider, url, headers }) => {
      const { deps, handler } = persistDeps();
      const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ data: {} }));
      vi.stubGlobal("fetch", fetchImpl);
      try {
        const response = await call(handler, "models/connect", {
          provider,
          apiKey: "fixture-key",
        });
        expect(response.status).toBe(200);
        expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({ headers }));
        expect(deps.secrets.put).toHaveBeenCalledWith(
          "fixture-key",
          expect.objectContaining({ userId: actor.userId }),
        );
        expect(fetchImpl.mock.invocationCallOrder[0]).toBeLessThan(
          vi.mocked(deps.secrets.put).mock.invocationCallOrder[0]!,
        );
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("rejects an API key for ChatGPT-subscription Codex before persisting", async () => {
    const { upsert, deps, handler } = persistDeps();

    const response = await call(handler, "models/connect", {
      provider: "openai-codex",
      apiKey: "sk-test-key-123",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      json: expect.objectContaining({
        code: "BAD_REQUEST",
        message: expect.stringContaining("ChatGPT subscription sign-in is required"),
      }),
    });
    expect(deps.secrets.put).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("still accepts an API key for other providers", async () => {
    const { deps, handler } = persistDeps();

    const response = await call(handler, "models/connect", {
      provider: "anthropic",
      apiKey: "sk-test-key-123",
    });

    expect(response.status).toBe(200);
    expect(deps.secrets.put).toHaveBeenCalledWith(
      "sk-test-key-123",
      expect.objectContaining({ userId: actor.userId }),
    );
  });

  it("checks the chosen model with the new key before saving it", async () => {
    const { deps, handler } = persistDeps();
    const check = vi.fn(async () => {
      throw new Error("Your model provider denied access to this model.");
    });
    Object.assign(deps, { modelConnectionCheck: check });

    const response = await call(handler, "models/connect", {
      provider: "groq",
      apiKey: "fixture-groq-key",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      json: { code: "BAD_REQUEST", message: "Your model provider denied access to this model." },
    });
    // No model chosen: the provider's recommended default is the one checked.
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "groq",
        id: "openai/gpt-oss-120b",
        apiKey: "fixture-groq-key",
      }),
      expect.any(Object),
    );
    expect(deps.secrets.put).not.toHaveBeenCalled();
  });

  it("refuses a pasted key that is not a header-safe token before checking it", async () => {
    const { deps, handler } = persistDeps();
    const check = vi.fn(async () => undefined);
    Object.assign(deps, { modelConnectionCheck: check });

    const response = await call(handler, "models/connect", {
      provider: "deepseek",
      apiKey: "sk-fixture-你好-key",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      json: { message: MODEL_KEY_FORMAT_ERROR },
    });
    expect(check).not.toHaveBeenCalled();
    expect(deps.secrets.put).not.toHaveBeenCalled();
  });

  it("adds another connection when the save names none, numbering its name", async () => {
    const { deps, handler } = persistDeps();
    const existing = {
      id: "cred-personal",
      userId: actor.userId,
      provider: "anthropic",
      label: "Anthropic",
      secretId: "secret-personal",
    };
    const credentials = deps.prisma.userModelCredential as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    credentials.findFirst!.mockResolvedValue(existing);
    credentials.findMany!.mockResolvedValue([{ label: "Anthropic" }]);
    credentials.update = vi.fn();

    const response = await call(handler, "models/connect", {
      provider: "anthropic",
      apiKey: "sk-test-key-123",
      label: "Anthropic",
      credentialId: null,
      makeDefault: false,
    });

    expect(response.status).toBe(200);
    expect(credentials.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ provider: "anthropic", label: "Anthropic 2" }),
    });
    expect(credentials.update).not.toHaveBeenCalled();
  });

  it("replaces only the connection a save names", async () => {
    const { deps, handler } = persistDeps();
    const work = {
      id: "cred-work",
      userId: actor.userId,
      provider: "anthropic",
      label: "Work",
      secretId: "secret-work",
    };
    const credentials = deps.prisma.userModelCredential as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    credentials.findFirst!.mockImplementation(async ({ where }: { where: { id?: string } }) =>
      where.id === work.id ? work : null,
    );
    credentials.update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...work,
      ...data,
    }));
    credentials.count = vi.fn().mockResolvedValue(0);
    Object.assign(deps.prisma, { secret: { findFirst: vi.fn().mockResolvedValue(null) } });
    const transaction = deps.prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
    transaction.mockImplementation(async (fn) =>
      fn(
        withModelRoles({
          userModelCredential: credentials,
          userVoiceCredential: { count: vi.fn().mockResolvedValue(0) },
          userModelPreference: deps.prisma.userModelPreference,
          secret: {
            create: vi.fn().mockResolvedValue({ id: "new-secret" }),
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        }),
      ),
    );

    const response = await call(handler, "models/connect", {
      provider: "anthropic",
      apiKey: "sk-test-key-123",
      credentialId: work.id,
      makeDefault: false,
    });
    expect(response.status).toBe(200);
    expect(credentials.update).toHaveBeenCalledWith({
      where: { id: work.id },
      data: { secretId: "new-secret" },
    });
    expect(credentials.create).not.toHaveBeenCalled();

    const missing = await call(handler, "models/connect", {
      provider: "anthropic",
      apiKey: "sk-test-key-123",
      credentialId: "cred-removed",
    });
    expect(missing.status).toBe(404);
  });

  it("binds an older app's sign-in to the provider's newest connection when it begins", async () => {
    const { deps, handler } = persistDeps();
    const begin = vi.fn(async () => ({
      loginId: "login-1",
      provider: "openai-codex",
      mode: "auth-url" as const,
      verificationUri: "https://auth.example.com/authorize",
      expiresInSeconds: 60,
    }));
    Object.assign(deps.oauthLogins, { begin });
    const credentials = deps.prisma.userModelCredential as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;
    credentials.findFirst!.mockResolvedValue({
      id: "cred-newest",
      userId: actor.userId,
      provider: "openai-codex",
      label: "ChatGPT",
      secretId: "secret-newest",
    });

    expect((await call(handler, "models/beginOAuth", { provider: "openai-codex" })).status).toBe(
      200,
    );
    expect(begin).toHaveBeenLastCalledWith(
      expect.objectContaining({ credentialId: "cred-newest" }),
    );

    // A new account stays a new account.
    await call(handler, "models/beginOAuth", { provider: "openai-codex", credentialId: null });
    expect(begin).toHaveBeenLastCalledWith(expect.objectContaining({ credentialId: null }));
  });

  it("tells the user to restart a pasted-code sign-in that is gone", async () => {
    const { deps, handler } = persistDeps();
    const message = "Sign-in session not found. Start sign-in again.";
    Object.assign(deps.oauthLogins, {
      submit: vi.fn().mockRejectedValue(new ModelSignInError(message)),
    });
    const response = await call(handler, "models/submitOAuthCode", {
      loginId: "login-1",
      code: "pasted-code",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ json: { message } });
  });

  it("names a second subscription account by the email it signed in with", async () => {
    const { finish, deps, handler } = persistDeps();
    const access = `fake.${Buffer.from(
      JSON.stringify({ "https://api.openai.com/profile": { email: "work@example.com" } }),
    ).toString("base64url")}.fake`;
    finish.mockImplementation(async (_loginId, _actor, persist) => ({
      status: "connected" as const,
      value: await persist({
        status: "connected",
        provider: "openai-codex",
        credentialId: null,
        credential: { type: "oauth", access, refresh: "refresh-token", expires: Date.now() + 1 },
        signal: new AbortController().signal,
      }),
    }));

    const response = await call(handler, "models/finishOAuth", { loginId: "login-1" });

    expect(response.status).toBe(200);
    expect(deps.prisma.userModelCredential.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider: "openai-codex", label: "work@example.com" }),
      }),
    );
  });

  it.each([
    ["github-copilot", "GitHub Copilot"],
    ["openai-codex", "OpenAI Codex"],
    ["anthropic", "Anthropic"],
  ])("labels a %s subscription sign-in with its own provider name", async (provider, label) => {
    const { finish, deps, handler } = persistDeps();
    finish.mockImplementation(async (_loginId, _actor, persist) => ({
      status: "connected" as const,
      value: await persist({
        status: "connected",
        provider,
        credential: {
          type: "oauth",
          access: "access-token",
          refresh: "refresh-token",
          expires: Date.now() + 60_000,
        },
        signal: new AbortController().signal,
      }),
    }));

    const response = await call(handler, "models/finishOAuth", { loginId: "login-1" });

    expect(response.status).toBe(200);
    expect(deps.prisma.userModelCredential.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ provider, label }),
      }),
    );
  });
});

describe("model disconnect", () => {
  const actor = {
    spaceId: "space-1",
    userId: "user-1",
    email: "user@labradoodle.test",
    isDeploymentOwner: true,
  } satisfies Actor;
  const connection = (id: string) => ({
    id,
    userId: actor.userId,
    provider: "openai-codex",
    label: id,
    secretId: `${id}-secret`,
  });

  function disconnectDeps() {
    const connections = [connection("personal"), connection("work")];
    const tx = {
      $queryRaw: vi.fn(async () => [{ bypass: null }]),
      userModelRoleChoice: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      userModelCredential: {
        findMany: vi.fn(async () => connections),
        deleteMany: vi.fn(async () => ({ count: 1 })),
        count: vi.fn(async () => 0),
      },
      userVoiceCredential: { count: vi.fn(async () => 0) },
      secret: { deleteMany: vi.fn(async () => ({ count: 1 })) },
    };
    const cancelProvider = vi.fn(async () => undefined);
    const deps = {
      prisma: { $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) },
      oauthLogins: { cancelProvider },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
        agentRuntime: "pi",
      },
    } as unknown as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));
    const call = async (body: unknown) =>
      handle(
        handler,
        new Request("http://127.0.0.1/rpc/models/disconnect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: body }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
    return { tx, cancelProvider, call };
  }

  it("removes one connection and its rows, keeping the other account's", async () => {
    const { tx, cancelProvider, call } = disconnectDeps();
    const response = await call({ provider: "openai-codex", credentialId: "work" });
    expect(response.status).toBe(200);
    expect(cancelProvider).toHaveBeenCalledWith({
      userId: actor.userId,
      provider: "openai-codex",
      credentialId: "work",
    });
    const workRows = {
      where: {
        userId: actor.userId,
        provider: "openai-codex",
        OR: [{ credentialId: { in: ["work"] } }],
      },
    };
    expect(tx.userModelRoleChoice.deleteMany).toHaveBeenCalledWith(workRows);
    expect(tx.userModelCredential.deleteMany).toHaveBeenCalledWith({
      where: { userId: actor.userId, id: { in: ["work"] } },
    });
    expect(tx.secret.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: "work-secret" },
    });
  });

  it("removes every connection of the provider for an app that names none", async () => {
    const { tx, call } = disconnectDeps();
    expect((await call({ provider: "openai-codex" })).status).toBe(200);
    const providerRows = {
      where: {
        userId: actor.userId,
        provider: "openai-codex",
        OR: [{ credentialId: { in: ["personal", "work"] } }, { credentialId: null }],
      },
    };
    expect(tx.userModelRoleChoice.deleteMany).toHaveBeenCalledWith(providerRows);
    expect(tx.userModelCredential.deleteMany).toHaveBeenCalledWith({
      where: { userId: actor.userId, id: { in: ["personal", "work"] } },
    });
  });
});

describe("codex catalog auth", () => {
  const actor = {
    spaceId: "workspace-1",
    userId: "user-1",
    email: "user@labradoodle.test",
    isDeploymentOwner: true,
  } satisfies Actor;
  const spark = "gpt-5.3-codex-spark";
  const luna = "gpt-6-luna";
  const oauth = JSON.stringify({
    type: "oauth",
    access: "access-token",
    refresh: "refresh-token",
    expires: Date.now() + 60_000,
  });
  const apiKey = "sk-test-api-key-12345678";

  async function call(handler: RouterHandler, path: string, body: unknown) {
    const response = await handle(
      handler,
      new Request(`http://127.0.0.1/rpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: body }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    return response;
  }

  function catalogDeps() {
    const load = vi.fn((ciphertext: string) => (ciphertext === "cipher-oauth" ? oauth : apiKey));
    const prisma = {
      userModelCredential: {
        findMany: vi.fn().mockResolvedValue([
          { provider: "openai-codex", secretId: "secret-api" },
          { provider: "openai-codex", secretId: "secret-oauth" },
        ]),
      },
      userModelPreference: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { credential: { provider: "openai-codex", secretId: "secret-oauth" } },
          ]),
      },
      secret: {
        findMany: vi.fn().mockResolvedValue([{ id: "secret-oauth", ciphertext: "cipher-oauth" }]),
      },
    };
    const deps = {
      prisma,
      secrets: { load },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
    } as unknown as RouterDeps;
    return { load, prisma, handler: new RPCHandler(createRouter(deps)) };
  }

  it("hides Codex Spark for the preferred ChatGPT credential when a newer key exists", async () => {
    const { load, prisma, handler } = catalogDeps();

    const response = await call(handler, "models/list", null);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      json: Array<{ provider: string; id: string }>;
    };
    expect(body.json.some((entry) => entry.provider === "openai-codex" && entry.id === spark)).toBe(
      false,
    );
    expect(body.json.some((entry) => entry.provider === "openai-codex" && entry.id === luna)).toBe(
      true,
    );
    expect(prisma.userModelPreference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: actor.userId },
      }),
    );
    expect(load).toHaveBeenCalledWith("cipher-oauth", "secret-oauth");
    expect(load).not.toHaveBeenCalledWith("cipher-api", "secret-api");
  });
});

describe("codex live catalog", () => {
  const actor = {
    spaceId: "workspace-1",
    userId: "user-1",
    email: "user@labradoodle.test",
    isDeploymentOwner: true,
  } satisfies Actor;
  const spark = "gpt-5.3-codex-spark";
  const luna = "gpt-6-luna";
  const sol = "gpt-6-sol";
  const oauth = (accountId?: string) =>
    JSON.stringify({
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() + 60_000,
      ...(accountId ? { accountId } : {}),
    });
  const apiKey = "sk-test-api-key-12345678";

  function liveModel(slug: string) {
    return {
      slug,
      reasoningEfforts: ["low", "medium", "high"],
      contextWindow: 272_000,
      supportsImages: false,
      supportsFastTier: true,
    };
  }

  async function call(handler: RouterHandler, path: string, body: unknown) {
    const response = await handle(
      handler,
      new Request(`http://127.0.0.1/rpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: body }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    return response;
  }

  async function listIds(handler: RouterHandler): Promise<string[]> {
    const response = await call(handler, "models/list", null);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      json: Array<{ provider: string; id: string }>;
    };
    return body.json.filter((entry) => entry.provider === "openai-codex").map((entry) => entry.id);
  }

  function catalogDeps(opts: {
    read: ReturnType<typeof vi.fn>;
    oauthAccountId?: string | null;
    apiKeyOnly?: boolean;
    disconnected?: boolean;
  }) {
    const oauthPlaintext = oauth(
      opts.oauthAccountId === null ? undefined : (opts.oauthAccountId ?? "acct-live-test"),
    );
    const load = vi.fn((ciphertext: string) =>
      ciphertext === "cipher-oauth" ? oauthPlaintext : apiKey,
    );
    const prisma = opts.disconnected
      ? {
          userModelCredential: { findMany: vi.fn().mockResolvedValue([]) },
          userModelPreference: { findMany: vi.fn().mockResolvedValue([]) },
          secret: { findMany: vi.fn().mockResolvedValue([]) },
        }
      : opts.apiKeyOnly
        ? {
            userModelCredential: {
              findMany: vi
                .fn()
                .mockResolvedValue([{ provider: "openai-codex", secretId: "secret-api" }]),
            },
            userModelPreference: { findMany: vi.fn().mockResolvedValue([]) },
            secret: {
              findMany: vi.fn().mockResolvedValue([{ id: "secret-api", ciphertext: "cipher-api" }]),
            },
          }
        : {
            userModelCredential: {
              findMany: vi.fn().mockResolvedValue([
                { provider: "openai-codex", secretId: "secret-api" },
                { provider: "openai-codex", secretId: "secret-oauth" },
              ]),
            },
            userModelPreference: {
              findMany: vi
                .fn()
                .mockResolvedValue([
                  { credential: { provider: "openai-codex", secretId: "secret-oauth" } },
                ]),
            },
            secret: {
              findMany: vi
                .fn()
                .mockResolvedValue([{ id: "secret-oauth", ciphertext: "cipher-oauth" }]),
            },
          };
    const deps = {
      prisma,
      secrets: { load },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      codexCatalog: { read: opts.read },
    } as unknown as RouterDeps;
    return { handler: new RPCHandler(createRouter(deps)) };
  }

  it("unlocks Spark and bounds the codex list to the live account catalog", async () => {
    const read = vi.fn().mockResolvedValue([liveModel(spark), liveModel(luna)]);
    const { handler } = catalogDeps({ read });

    const ids = await listIds(handler);

    expect(ids).toContain(spark);
    expect(ids).toContain(luna);
    expect(ids).not.toContain(sol);
    expect(read).toHaveBeenCalledWith(
      actor.userId,
      expect.objectContaining({ accountId: "acct-live-test" }),
    );
  });

  it("keeps the static oauth catalog when the live read fails", async () => {
    const read = vi.fn().mockResolvedValue(undefined);
    const { handler } = catalogDeps({ read });

    const ids = await listIds(handler);

    expect(ids).not.toContain(spark);
    expect(ids).toContain(luna);
  });

  it("ignores a live catalog that shares no known codex slug", async () => {
    const read = vi.fn().mockResolvedValue([liveModel("gpt-unknown-from-backend")]);
    const { handler } = catalogDeps({ read });

    const ids = await listIds(handler);

    expect(ids).not.toContain(spark);
    expect(ids).toContain(luna);
    expect(ids).not.toContain("gpt-unknown-from-backend");
  });

  it("never reads the catalog for an API-key credential", async () => {
    const read = vi.fn().mockResolvedValue([liveModel(spark)]);
    const { handler } = catalogDeps({ read, apiKeyOnly: true });

    const ids = await listIds(handler);

    // Pi no longer bundles Spark for Codex; only an account catalog can add it.
    expect(ids).not.toContain(spark);
    expect(ids).toContain(luna);
    expect(read).not.toHaveBeenCalled();
  });

  it("never reads the catalog when no credential exists", async () => {
    const read = vi.fn().mockResolvedValue([liveModel(spark)]);
    const { handler } = catalogDeps({ read, disconnected: true });

    const ids = await listIds(handler);

    // Disconnected browsing still lists Codex models but keeps the Spark exclusion.
    expect(ids).not.toContain(spark);
    expect(ids).toContain(luna);
    expect(read).not.toHaveBeenCalled();
  });

  it("falls back to the static catalog when the oauth credential has no account id", async () => {
    const read = vi.fn().mockResolvedValue([liveModel(spark)]);
    const { handler } = catalogDeps({ read, oauthAccountId: null });

    const ids = await listIds(handler);

    expect(ids).not.toContain(spark);
    expect(ids).toContain(luna);
    expect(read).not.toHaveBeenCalled();
  });

  it("governs each codex model by the credential that owns it", async () => {
    const stamp = new Date("2026-01-01T00:00:00.000Z");
    const credentialA = {
      id: "cred-a",
      userId: actor.userId,
      provider: "openai-codex",
      label: "ChatGPT A",
      secretId: "secret-a",
      createdAt: stamp,
      updatedAt: stamp,
    };
    const credentialB = { ...credentialA, id: "cred-b", secretId: "secret-b" };
    const prisma = {
      userModelCredential: { findMany: vi.fn().mockResolvedValue([credentialA, credentialB]) },
      userModelPreference: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "pref-luna",
            modelId: luna,
            updatedAt: stamp,
            credential: credentialA,
          },
          {
            id: "pref-spark",
            modelId: spark,
            updatedAt: stamp,
            credential: credentialB,
          },
        ]),
      },
      secret: {
        findMany: vi.fn().mockResolvedValue([
          { id: "secret-a", ciphertext: "cipher-a" },
          { id: "secret-b", ciphertext: "cipher-b" },
        ]),
      },
    };
    const secrets = {
      load: (ciphertext: string) => (ciphertext === "cipher-a" ? oauth("acct-a") : oauth("acct-b")),
    };
    const deps = {
      prisma,
      secrets,
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
    } as unknown as RouterDeps;

    // Spark's preference points at account B: only B's catalog can unlock it.
    const read = vi.fn(async (_userId: string, account: { accountId: string }) =>
      // A catalog is trusted only when it shares a bundled slug, so B lists Luna too.
      account.accountId === "acct-b" ? [liveModel(spark), liveModel(luna)] : [liveModel(luna)],
    );
    deps.codexCatalog = { read };
    const first = await listIds(new RPCHandler(createRouter(deps)));
    expect(first).toContain(spark);
    expect(first).toContain(luna);

    // Account A listing Spark must not unlock it — B's catalog does not list it.
    const swapped = vi.fn(async (_userId: string, account: { accountId: string }) =>
      account.accountId === "acct-a" ? [liveModel(spark), liveModel(luna)] : [liveModel(luna)],
    );
    deps.codexCatalog = { read: swapped };
    const second = await listIds(new RPCHandler(createRouter(deps)));
    expect(second).not.toContain(spark);
    expect(second).toContain(luna);
  });

  it("never fetches the catalog for an expired token and kicks a detached refresh", async () => {
    const expiredOauth = JSON.stringify({
      type: "oauth",
      access: "access-token",
      refresh: "refresh-token",
      expires: Date.now() - 1_000,
      accountId: "acct-live-test",
    });
    const prisma = {
      userModelCredential: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ provider: "openai-codex", secretId: "secret-oauth" }]),
      },
      userModelPreference: { findMany: vi.fn().mockResolvedValue([]) },
      secret: {
        findMany: vi.fn().mockResolvedValue([{ id: "secret-oauth", ciphertext: "cipher-oauth" }]),
      },
    };
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ models: [{ slug: spark, visibility: "list", supported_in_api: true }] }),
          { status: 200 },
        ),
    );
    const refreshExpiredModelCredential = vi.fn();
    const deps = {
      prisma,
      secrets: { load: vi.fn(() => expiredOauth), put: vi.fn() },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      codexCatalog: new CodexCatalogCache({ enabled: true, fetch: fetchImpl }),
      refreshExpiredModelCredential,
    } as unknown as RouterDeps;

    const ids = await listIds(new RPCHandler(createRouter(deps)));

    // Static exclusion stands this round; the credential's refresh is kicked so
    // the next read can see the account's real catalog.
    expect(ids).not.toContain(spark);
    expect(ids).toContain(luna);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(refreshExpiredModelCredential).toHaveBeenCalledWith(
      expect.objectContaining({ userId: actor.userId }),
      "secret-oauth",
      "openai-codex",
    );
  });

  it("lets models.setDefault pick Spark when the account's live catalog lists it", async () => {
    const stamp = new Date("2026-01-01T00:00:00.000Z");
    const oauthCredential = {
      id: "cred-oauth",
      userId: actor.userId,
      provider: "openai-codex",
      label: "ChatGPT",
      secretId: "secret-oauth",
      createdAt: stamp,
      updatedAt: stamp,
    };
    const upsert = vi.fn(async () => ({ id: "pref-spark" }));
    const tx = {
      userModelCredential: { findMany: vi.fn().mockResolvedValue([oauthCredential]) },
      userModelPreference: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(async () => ({ count: 0 })),
        upsert,
      },
      secret: {
        findFirst: vi.fn(async () => ({ id: "secret-oauth", ciphertext: "cipher-oauth" })),
      },
    };
    const deps = {
      prisma: { ...tx, $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) },
      secrets: { load: vi.fn(() => oauth("acct-live-test")) },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      codexCatalog: { read: vi.fn(async () => [liveModel(spark)]) },
    } as unknown as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));

    const response = await call(handler, "models/setDefault", {
      provider: "openai-codex",
      modelId: spark,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ json: { ok: true } });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_credentialId: {
            userId: actor.userId,
            credentialId: "cred-oauth",
          },
        },
      }),
    );
  });

  it("still rejects models.setDefault for Spark when the live catalog omits it", async () => {
    const stamp = new Date("2026-01-01T00:00:00.000Z");
    const oauthCredential = {
      id: "cred-oauth",
      userId: actor.userId,
      provider: "openai-codex",
      label: "ChatGPT",
      secretId: "secret-oauth",
      createdAt: stamp,
      updatedAt: stamp,
    };
    const tx = {
      userModelCredential: { findMany: vi.fn().mockResolvedValue([oauthCredential]) },
      userModelPreference: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(async () => ({ count: 0 })),
        upsert: vi.fn(async () => ({ id: "pref-spark" })),
      },
      secret: {
        findFirst: vi.fn(async () => ({ id: "secret-oauth", ciphertext: "cipher-oauth" })),
      },
    };
    const deps = {
      prisma: { ...tx, $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) },
      secrets: { load: vi.fn(() => oauth("acct-live-test")) },
      env: {
        defaultProvider: "fake",
        defaultModel: "fake-model",
        webOrigin: "http://127.0.0.1:5173",
        screenProxySecret: "fake-test-secret",
        sandboxProvider: "fake",
      },
      codexCatalog: { read: vi.fn(async () => [liveModel(luna)]) },
    } as unknown as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));

    const response = await call(handler, "models/setDefault", {
      provider: "openai-codex",
      modelId: spark,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      json: expect.objectContaining({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/not available with your current sign-in/i),
      }),
    });
  });

  it.each(["unchanged", "rotated", "reconnected", "unavailable"] as const)(
    "prepares slow model secrets before the transaction: %s",
    async (change) => {
      const stamp = new Date("2026-01-01T00:00:00.000Z");
      const oauthCredential = {
        id: "cred-oauth",
        userId: actor.userId,
        provider: "openai-codex",
        label: "ChatGPT",
        secretId: "secret-oauth",
        createdAt: stamp,
        updatedAt: stamp,
      };
      const upsert = vi.fn(async () => ({ id: "pref-spark" }));
      const tx = {
        userModelCredential: { findMany: vi.fn().mockResolvedValue([oauthCredential]) },
        userModelPreference: {
          findMany: vi.fn().mockResolvedValue([]),
          updateMany: vi.fn(async () => ({ count: 0 })),
          upsert,
        },
        secret: {
          findFirst: vi.fn(async () => ({ id: "secret-oauth", ciphertext: "cipher-oauth" })),
        },
      };
      let elapsed = 0;
      let inTransaction = false;
      const transaction = vi.fn(async (fn: (client: typeof tx) => unknown) => {
        if (change === "rotated")
          tx.secret.findFirst.mockResolvedValue({ id: "secret-oauth", ciphertext: "rotated" });
        if (change === "reconnected")
          tx.userModelCredential.findMany.mockResolvedValue([
            { ...oauthCredential, secretId: "replacement" },
          ]);
        const started = elapsed;
        inTransaction = true;
        try {
          const result = await fn(tx);
          expect(elapsed - started).toBeLessThan(5_000);
          return result;
        } finally {
          inTransaction = false;
        }
      });
      const prisma = {
        $transaction: transaction,
        userModelCredential: tx.userModelCredential,
        userModelPreference: { findMany: tx.userModelPreference.findMany },
        secret: tx.secret,
      };
      const read = vi.fn(
        async (_userId: string, _account: { accountId: string }, _opts?: { waitMs?: number }) => [
          liveModel(spark),
        ],
      );
      const refreshExpiredModelCredential = vi.fn();
      const deps = {
        prisma,
        secrets: {
          load: vi.fn(async () => {
            expect(inTransaction).toBe(false);
            elapsed += 15_000;
            if (change === "unavailable") throw new SecretStoreUnavailableError();
            return oauth("acct-live-test");
          }),
          put: vi.fn(),
        },
        env: {
          defaultProvider: "fake",
          defaultModel: "fake-model",
          webOrigin: "http://127.0.0.1:5173",
          screenProxySecret: "fake-test-secret",
          sandboxProvider: "fake",
        },
        codexCatalog: { read },
        refreshExpiredModelCredential,
      } as unknown as RouterDeps;
      const handler = new RPCHandler(createRouter(deps));

      const response = await call(handler, "models/setDefault", {
        provider: "openai-codex",
        modelId: spark,
      });

      expect(elapsed).toBe(15_000);
      expect(response.status).toBe(
        change === "unchanged" ? 200 : change === "unavailable" ? 503 : 409,
      );
      if (change === "unchanged") {
        expect(read).toHaveBeenCalledTimes(1);
        expect(read.mock.invocationCallOrder[0]).toBeLessThan(
          transaction.mock.invocationCallOrder[0]!,
        );
        expect(upsert).toHaveBeenCalled();
      } else {
        expect(upsert).not.toHaveBeenCalled();
      }
    },
  );
});

describe("model set default auth", () => {
  const actor = {
    spaceId: "workspace-1",
    userId: "user-1",
    email: "user@labradoodle.test",
    isDeploymentOwner: true,
  } satisfies Actor;
  const spark = "gpt-5.3-codex-spark";
  const luna = "gpt-6-luna";
  const oauth = JSON.stringify({
    type: "oauth",
    access: "access-token",
    refresh: "refresh-token",
    expires: Date.now() + 60_000,
  });
  const apiKey = "sk-test-api-key-12345678";

  async function call(handler: RouterHandler, path: string, body: unknown) {
    const response = await handle(
      handler,
      new Request(`http://127.0.0.1/rpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: body }),
      }),
      { prefix: "/rpc", context: { actor } },
    );
    return response;
  }

  it("sets Spark from the API-key preference when a newer ChatGPT credential exists", async () => {
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-02-01T00:00:00.000Z");
    const apiCredential = {
      id: "cred-api",
      userId: actor.userId,
      provider: "openai-codex",
      label: "API key",
      secretId: "secret-api",
      createdAt: older,
      updatedAt: older,
    };
    const oauthCredential = {
      id: "cred-oauth",
      userId: actor.userId,
      provider: "openai-codex",
      label: "ChatGPT",
      secretId: "secret-oauth",
      createdAt: newer,
      updatedAt: newer,
    };
    const secretFindFirst = vi.fn(async (args: { where: { id?: string } }) => {
      if (args.where.id === "secret-api") return { id: "secret-api", ciphertext: "cipher-api" };
      if (args.where.id === "secret-oauth") {
        return { id: "secret-oauth", ciphertext: "cipher-oauth" };
      }
      return null;
    });
    const upsert = vi.fn(async () => ({ id: "pref-spark" }));
    const tx = {
      userModelCredential: {
        findMany: vi.fn().mockResolvedValue([oauthCredential, apiCredential]),
      },
      userModelPreference: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "pref-spark",
            modelId: spark,
            updatedAt: older,
            credential: apiCredential,
          },
          {
            id: "pref-luna",
            modelId: luna,
            updatedAt: newer,
            credential: oauthCredential,
          },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        upsert,
      },
      secret: { findFirst: secretFindFirst },
    };
    const load = vi.fn((ciphertext: string) => (ciphertext === "cipher-oauth" ? oauth : apiKey));
    const handler = new RPCHandler(
      createRouter({
        prisma: {
          ...tx,
          $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
        },
        secrets: { load },
        env: {
          defaultProvider: "fake",
          defaultModel: "fake-model",
          webOrigin: "http://127.0.0.1:5173",
          screenProxySecret: "fake-test-secret",
          sandboxProvider: "fake",
        },
      } as unknown as RouterDeps),
    );

    const response = await call(handler, "models/setDefault", {
      provider: "openai-codex",
      modelId: spark,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ json: { ok: true } });
    expect(secretFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "secret-api", userId: actor.userId, spaceId: null }),
      }),
    );
    expect(load).toHaveBeenCalledWith("cipher-api", "secret-api");
    expect(load).not.toHaveBeenCalledWith("cipher-oauth", "secret-oauth");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_credentialId: {
            userId: actor.userId,
            credentialId: "cred-api",
          },
        },
        update: { modelId: spark, thinkingLevel: null },
      }),
    );
  });

  it("keeps the effort the main list has for the model on the chosen connection", async () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const connection = (id: string) => ({
      id,
      userId: actor.userId,
      provider: "openai-codex",
      label: id,
      secretId: `secret-${id}`,
      createdAt: at,
      updatedAt: at,
    });
    const [work, personal] = [connection("cred-work"), connection("cred-personal")];
    const tx = {
      userModelCredential: { findMany: vi.fn().mockResolvedValue([work, personal]) },
      userModelPreference: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: "pref-personal", modelId: luna, updatedAt: at, credential: personal },
          ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        upsert: vi.fn(async () => ({ id: "pref-personal" })),
      },
      secret: {
        findFirst: vi.fn(async (args: { where: { id?: string } }) =>
          args.where.id ? { id: args.where.id, ciphertext: `cipher-${args.where.id}` } : null,
        ),
      },
    };
    const prisma = {
      ...tx,
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const handler = new RPCHandler(
      createRouter({
        prisma,
        secrets: { load: vi.fn(() => apiKey) },
        env: {
          defaultProvider: "fake",
          defaultModel: "fake-model",
          webOrigin: "http://127.0.0.1:5173",
          screenProxySecret: "fake-test-secret",
          sandboxProvider: "fake",
        },
      } as unknown as RouterDeps),
    );
    const roles = (
      prisma as unknown as {
        userModelRoleChoice: {
          createMany: (args: { data: unknown[] }) => Promise<unknown>;
          findMany: (args: { where: Record<string, string> }) => Promise<unknown[]>;
        };
      }
    ).userModelRoleChoice;
    const row = (position: number, credentialId: string, thinkingLevel: string) => ({
      userId: actor.userId,
      spaceId: actor.spaceId,
      role: "main",
      position,
      provider: "openai-codex",
      modelId: luna,
      thinkingLevel,
      credentialId,
    });
    // The same model runs first on another connection with a different effort.
    await roles.createMany({ data: [row(0, work.id, "low"), row(1, personal.id, "high")] });

    const response = await call(handler, "models/setDefault", {
      provider: "openai-codex",
      modelId: luna,
    });

    expect(response.status).toBe(200);
    const main = await roles.findMany({
      where: { userId: actor.userId, spaceId: actor.spaceId, role: "main" },
    });
    expect(main[0]).toMatchObject({ credentialId: personal.id, thinkingLevel: "high" });
  });

  it("rebinds a Spark API-key preference when another Codex model becomes the default", async () => {
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-02-01T00:00:00.000Z");
    const apiCredential = {
      id: "cred-api",
      userId: actor.userId,
      provider: "openai-codex",
      label: "API key",
      secretId: "secret-api",
      createdAt: older,
      updatedAt: older,
    };
    const oauthCredential = {
      id: "cred-oauth",
      userId: actor.userId,
      provider: "openai-codex",
      label: "ChatGPT",
      secretId: "secret-oauth",
      createdAt: newer,
      updatedAt: newer,
    };
    const secretFindFirst = vi.fn(async (args: { where: { id?: string } }) => {
      if (args.where.id === "secret-api") return { id: "secret-api", ciphertext: "cipher-api" };
      if (args.where.id === "secret-oauth") {
        return { id: "secret-oauth", ciphertext: "cipher-oauth" };
      }
      return null;
    });
    const upsert = vi.fn(async () => ({ id: "pref-luna" }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      userModelCredential: {
        findMany: vi.fn().mockResolvedValue([oauthCredential, apiCredential]),
      },
      userModelPreference: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "pref-spark",
            modelId: spark,
            updatedAt: older,
            credential: apiCredential,
          },
        ]),
        updateMany,
        upsert,
      },
      secret: { findFirst: secretFindFirst },
    };
    const load = vi.fn((ciphertext: string) => (ciphertext === "cipher-oauth" ? oauth : apiKey));
    const handler = new RPCHandler(
      createRouter({
        prisma: {
          ...tx,
          $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
        },
        secrets: { load },
        env: {
          defaultProvider: "fake",
          defaultModel: "fake-model",
          webOrigin: "http://127.0.0.1:5173",
          screenProxySecret: "fake-test-secret",
          sandboxProvider: "fake",
        },
      } as unknown as RouterDeps),
    );

    const response = await call(handler, "models/setDefault", {
      provider: "openai-codex",
      modelId: luna,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ json: { ok: true } });
    expect(load).toHaveBeenCalledWith("cipher-oauth", "secret-oauth");
    expect(upsert).toHaveBeenCalledTimes(1);
    // Pi no longer bundles Spark for Codex, so its binding is no longer an auth-restricted
    // model to protect and the older credential takes the new default.
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_credentialId: {
            userId: actor.userId,
            credentialId: "cred-api",
          },
        },
        create: expect.objectContaining({ modelId: luna }),
        update: { modelId: luna, thinkingLevel: null },
      }),
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("keeps the working space credential when the other Codex secret cannot be read", async () => {
    const older = new Date("2026-01-01T00:00:00.000Z");
    const newer = new Date("2026-02-01T00:00:00.000Z");
    const apiCredential = {
      id: "cred-api",
      userId: actor.userId,
      provider: "openai-codex",
      label: "API key",
      secretId: "secret-api",
      createdAt: older,
      updatedAt: older,
    };
    const oauthCredential = {
      id: "cred-oauth",
      userId: actor.userId,
      provider: "openai-codex",
      label: "ChatGPT",
      secretId: "secret-oauth",
      createdAt: newer,
      updatedAt: newer,
    };
    const upsert = vi.fn(async () => ({ id: "pref-luna" }));
    const tx = {
      userModelCredential: {
        findMany: vi.fn().mockResolvedValue([oauthCredential, apiCredential]),
      },
      userModelPreference: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "pref-spark",
            modelId: spark,
            updatedAt: older,
            credential: apiCredential,
          },
        ]),
        updateMany: vi.fn(async () => ({ count: 1 })),
        upsert,
      },
      secret: {
        findFirst: vi.fn(async (args: { where: { id?: string } }) => {
          if (args.where.id === "secret-api") return { id: "secret-api", ciphertext: "cipher-api" };
          if (args.where.id === "secret-oauth") {
            return { id: "secret-oauth", ciphertext: "cipher-oauth" };
          }
          return null;
        }),
      },
    };
    const load = vi.fn((ciphertext: string) => {
      if (ciphertext === "cipher-oauth") throw new Error("unreadable");
      return apiKey;
    });
    const handler = new RPCHandler(
      createRouter({
        prisma: {
          ...tx,
          $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
        },
        secrets: { load },
        env: {
          defaultProvider: "fake",
          defaultModel: "fake-model",
          webOrigin: "http://127.0.0.1:5173",
          screenProxySecret: "fake-test-secret",
          sandboxProvider: "fake",
        },
      } as unknown as RouterDeps),
    );

    const response = await call(handler, "models/setDefault", {
      provider: "openai-codex",
      modelId: luna,
    });

    expect(response.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_credentialId: {
            userId: actor.userId,
            credentialId: "cred-api",
          },
        },
        update: { modelId: luna, thinkingLevel: null },
      }),
    );
  });
});

afterEach(() => {
  delete process.env.SANDBOX_MAX_COMPUTERS_PER_USER;
});

describe("routines.update", () => {
  const actor = {
    spaceId: "space-1",
    userId: "user-1",
    email: "user@labradoodle.test",
    isDeploymentOwner: true,
  } satisfies Actor;
  const routine = {
    id: "routine-1",
    botId: "bot-1",
    spaceId: "space-1",
    userId: "user-1",
    name: "Later",
    prompt: "say done",
    crons: ["@once"],
    timezone: "UTC",
    active: false,
    notify: false,
    webhookEnabled: false,
    githubEnabled: false,
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
  };

  function fixture(archivedBeforeWrite = false, model: Record<string, unknown> = {}) {
    const savedRoutine: Record<string, unknown> = { ...routine, ...model };
    const update = vi.fn(
      async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (archivedBeforeWrite) throw Object.assign(new Error("not found"), { code: "P2025" });
        return {
          ...savedRoutine,
          ...Object.fromEntries(
            Object.entries(args.data).filter(([, value]) => value !== undefined),
          ),
        };
      },
    );
    const enqueue = vi.fn(async () => undefined);
    const cancel = vi.fn(async () => undefined);
    const moveQueued = vi.fn(async (_args: unknown) => [] as Array<{ taskId: string }>);
    const prisma = {
      secret: { findFirst: vi.fn(async () => null) },
      userModelPreference: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => ({ id: "preference-1" })),
      },
      userModelCredential: {
        findMany: vi.fn(async () => [
          {
            id: "credential-1",
            provider: "openai-compatible",
            apiKey: "fake-key",
            userId: actor.userId,
          },
        ]),
      },
      routine: {
        findFirst: vi.fn(async () => savedRoutine),
        update,
        count: vi.fn(async () => 0),
      },
      run: { updateManyAndReturn: moveQueued },
      bot: { findFirst: vi.fn(async () => ({ id: "bot-1" })) },
    };
    const handler = new RPCHandler(
      createRouter({
        prisma,
        env: { sandboxProvider: "fake" },
        events: { append: vi.fn(async () => undefined) },
        jobs: { enqueue, cancel },
      } as unknown as RouterDeps),
    );
    const call = (patch: Record<string, unknown> = {}) =>
      handle(
        handler,
        new Request("http://127.0.0.1/rpc/routines/update", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            json: {
              routineId: "routine-1",
              active: true,
              runAt: new Date(Date.now() + 60_000).toISOString(),
              ...patch,
            },
          }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
    return { update, enqueue, cancel, call, moveQueued, findFirst: prisma.routine.findFirst };
  }

  const recurring = {
    crons: ["0 9 * * *"],
    active: true,
    nextRunAt: new Date("2026-09-02T09:00:00.000Z"),
  };

  it("rejects a schedule change when an enable landed after the read", async () => {
    // The editor omits an unchanged on/off; the new schedule was computed for a paused routine.
    const { call, update, enqueue } = fixture(false, { crons: ["0 9 * * *"] });
    update.mockImplementationOnce(async (args) => {
      expect(args.where).toMatchObject({ active: false });
      throw Object.assign(new Error("not found"), { code: "P2025" });
    });
    expect(
      (await call({ crons: ["0 10 * * *"], active: undefined, runAt: undefined })).status,
    ).toBe(409);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects an explicit on/off when a disable landed after the read", async () => {
    // The editor sends `active` with every save. A disable that commits between the read and
    // the write must not be undone by a rename that still says "on".
    const { call, update, enqueue, cancel } = fixture(false, recurring);
    update.mockImplementationOnce(async (args) => {
      expect(args.where).toMatchObject({ active: true });
      throw Object.assign(new Error("not found"), { code: "P2025" });
    });
    expect((await call({ name: "Renamed", active: true, runAt: undefined })).status).toBe(409);
    expect(enqueue).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("rejects a schedule change when the routine fired after the read", async () => {
    const { call, update, enqueue } = fixture(false, recurring);
    update.mockImplementationOnce(async (args) => {
      expect(args.where).toMatchObject({ nextRunAt: recurring.nextRunAt });
      throw Object.assign(new Error("not found"), { code: "P2025" });
    });
    expect((await call({ crons: ["0 10 * * *"], runAt: undefined })).status).toBe(409);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("openai-compatible enabled models", () => {
  const actor = {
    spaceId: "space-1",
    userId: "user-1",
    email: "user@labradoodle.test",
    isDeploymentOwner: true,
  } satisfies Actor;
  const compatible = "openai-compatible";
  const baseUrl = "https://10.0.0.5:8443/v1";
  /** A pin row; space and user default to the actor's. */
  type Pin = {
    name: string;
    modelId: string;
    archived?: boolean;
    spaceId?: string;
    userId?: string;
    role?: string;
    position?: number;
  };
  type PinWhere = {
    spaceId?: string;
    archivedAt?: null;
    bot?: { archivedAt: null };
    userId?: string;
    modelProvider?: string;
    provider?: string;
    modelId?: string | { notIn?: string[] };
  };

  function secretText(enabledModelIds?: string[], reasoning?: boolean) {
    return serializeModelSecret({
      kind: "openai_compatible",
      baseUrl,
      apiKey: "sk-fake-compatible-key",
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(enabledModelIds ? { enabledModelIds } : {}),
    });
  }

  /** Applies the subset of a Prisma pin `where` the router uses. */
  function matching(pins: Pin[] | undefined, where: PinWhere) {
    return (pins ?? [])
      .map((pin) => ({ spaceId: actor.spaceId, userId: actor.userId, ...pin }))
      .filter(
        (pin) =>
          (where.modelProvider ?? where.provider) === compatible &&
          (where.spaceId === undefined || pin.spaceId === where.spaceId) &&
          (where.userId === undefined || pin.userId === where.userId) &&
          !((where.archivedAt === null || where.bot?.archivedAt === null) && pin.archived) &&
          (typeof where.modelId === "string"
            ? pin.modelId === where.modelId
            : !where.modelId?.notIn?.includes(pin.modelId)),
      )
      .map(({ name, spaceId, modelId, role, position }) => ({
        name,
        spaceId,
        modelId,
        role,
        position,
      }));
  }

  function pinStores(options: {
    bots?: Pin[];
    routines?: Pin[];
    backups?: string[];
    roleChoices?: string[];
    mainPrimary?: string;
  }) {
    // The main model and its fallbacks are role choices too.
    const roleChoices = [
      ...(options.mainPrimary
        ? [{ name: "", modelId: options.mainPrimary, role: "main", position: 0 }]
        : []),
      ...(options.backups ?? []).map((modelId, index) => ({
        name: "",
        modelId,
        role: "main",
        position: index + 1,
      })),
      ...(options.roleChoices ?? []).map((modelId) => ({
        name: "",
        modelId,
        role: "approval",
        position: 0,
      })),
    ];
    return {
      bots: (where: PinWhere) => matching(options.bots, where),
      routine: {
        findMany: vi.fn(async ({ where }: { where: PinWhere }) =>
          matching(options.routines, where),
        ),
      },
      // The account's models; no Space overrides them.
      userModelRoleChoice: {
        findMany: vi.fn(async ({ where }: { where: PinWhere }) => matching(roleChoices, where)),
      },
    };
  }

  function botRow(modelId: string) {
    const now = new Date("2026-01-01T00:00:00.000Z");
    return {
      id: "bot-1",
      spaceId: actor.spaceId,
      userId: actor.userId,
      name: "Ada",
      title: "",
      instructions: "",
      color: "ink",
      notifyOnFinish: true,
      archivedAt: null,
      memoryScope: null,
      createdAt: now,
      updatedAt: now,
      voiceId: null,
      autoSpeak: false,
      modelProvider: compatible,
      modelId,
      thinkingLevel: null,
      webhookSecretId: null,
      thread: { id: "thread-1", unread: false, messages: [], runs: [] },
      computer: null,
      runs: [],
    };
  }

  function preferenceStore(state: {
    credential: Record<string, unknown>;
    preference: Record<string, unknown>;
  }) {
    const withCredential = (): Record<string, unknown> => ({
      ...state.preference,
      credential: state.credential,
    });
    type PreferenceWhere = {
      isDefault?: boolean;
      modelId?: string;
      credential?: { provider?: string };
    };
    return {
      findMany: vi.fn(async ({ where }: { where: PreferenceWhere }) =>
        where.credential?.provider && where.credential.provider !== compatible
          ? []
          : [withCredential()],
      ),
      findFirst: vi.fn(async ({ where }: { where: PreferenceWhere }) => {
        const preference = withCredential();
        if (where.modelId !== undefined && where.modelId !== preference.modelId) return null;
        if (where.credential?.provider && where.credential.provider !== compatible) return null;
        return preference;
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
      upsert: vi.fn(async ({ update }: { update: Record<string, unknown> }) =>
        Object.assign(state.preference, update),
      ),
    };
  }

  function fixture(options: {
    /** Stored plaintext; null makes the stored ciphertext unreadable. */
    plaintext: string | null;
    alternatePlaintext?: string;
    defaultModel: string;
    thinkingLevel?: string;
    /** Another provider runs the main model, so the compatible default is not it. */
    mainElsewhere?: boolean;
    botModelId?: string;
    bots?: Pin[];
    routines?: Pin[];
    backups?: string[];
    roleChoices?: string[];
    mainPrimary?: string;
  }) {
    const state = {
      credential: {
        id: "cred-compat",
        userId: actor.userId,
        provider: compatible,
        label: "Compatible",
        secretId: "secret-compat",
        supportsImages: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      } as Record<string, unknown>,
      preference: {
        userId: actor.userId,
        credentialId: "cred-compat",
        modelId: options.defaultModel,
        thinkingLevel: options.thinkingLevel ?? null,
        updatedAt: new Date(0),
      } as Record<string, unknown>,
    };
    const alternate = { ...state.credential, id: "cred-alternate", secretId: "secret-alternate" };
    const initialCredential = { ...state.credential };
    const ciphertexts = new Map([["secret-compat", "cipher-compat"]]);
    const plaintexts = new Map<string, string>();
    if (options.plaintext !== null) plaintexts.set("cipher-compat", options.plaintext);
    if (options.alternatePlaintext) {
      ciphertexts.set("secret-alternate", "cipher-alternate");
      plaintexts.set("cipher-alternate", options.alternatePlaintext);
    }
    const pins = pinStores(options);
    const bot = botRow(options.botModelId ?? options.defaultModel);
    const prisma = {
      ...pins,
      $queryRaw: vi.fn(async () => []),
      bot: {
        findFirst: vi.fn(async () => bot),
        findMany: vi.fn(async ({ where }: { where: PinWhere }) =>
          where.modelProvider ? pins.bots(where) : [bot],
        ),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
          Object.assign(
            bot,
            Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)),
          ),
        ),
      },
      userModelPreference: preferenceStore(state),
      userModelCredential: {
        findMany: vi.fn(async ({ where }: { where: { provider?: string } }) =>
          where.provider === compatible
            ? [state.credential, ...(options.alternatePlaintext ? [alternate] : [])]
            : [],
        ),
        findFirst: vi.fn(async ({ where }: { where: { provider?: string | { in: string[] } } }) =>
          (
            typeof where.provider === "string"
              ? where.provider === compatible
              : where.provider?.in.includes(compatible)
          )
            ? state.credential
            : null,
        ),
        create: vi.fn(),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
          Object.assign(state.credential, data),
        ),
        count: vi.fn(async () => 0),
      },
      userVoiceCredential: { count: vi.fn(async () => 0) },
      secret: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => {
          const ciphertext = ciphertexts.get(where.id);
          return ciphertext ? { id: where.id, ciphertext } : null;
        }),
        create: vi.fn(async ({ data }: { data: { id: string; ciphertext: string } }) => {
          ciphertexts.set(data.id, data.ciphertext);
          return data;
        }),
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      deploymentSettings: { findUnique: vi.fn(async () => null) },
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          email: actor.email,
          name: "User",
          avatarStyle: "organic",
          secrets: [],
        })),
      },
      $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(prisma)),
    };
    const secrets = {
      load: vi.fn(async (ciphertext: string) => {
        const plaintext = plaintexts.get(ciphertext);
        if (plaintext === undefined) throw new Error("fixture ciphertext is unreadable");
        return plaintext;
      }),
      put: vi.fn(async (plaintext: string) => {
        plaintexts.set("cipher-new", plaintext);
        return { id: "secret-new", ciphertext: "cipher-new" };
      }),
    };
    withModelRoles(
      prisma,
      options.mainElsewhere
        ? []
        : [mainRole(actor, compatible, options.defaultModel, options.thinkingLevel)],
    );
    const handler = new RPCHandler(
      createRouter({
        prisma,
        secrets,
        events: { notify: vi.fn().mockResolvedValue(undefined) },
        env: {
          defaultProvider: "fake",
          defaultModel: "fake-model",
          webOrigin: "http://127.0.0.1:5173",
          screenProxySecret: "fake-test-secret",
          sandboxProvider: "fake",
          agentRuntime: "pi",
          mcpAllowPrivateEndpoint: true,
        },
      } as unknown as RouterDeps),
    );
    const call = async (path: string, body: unknown) => {
      const response = await handle(
        handler,
        new Request(`http://127.0.0.1/rpc/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: body }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
      const payload = (await response.json()) as { json: { message?: string } };
      return { status: response.status, message: payload.json.message };
    };
    const enabledInDto = () =>
      modelCredentialDto(
        { ...state.credential, defaultModel: state.preference.modelId } as never,
        options.plaintext ?? "",
      ).enabledModelIds;
    return { state, initialCredential, prisma, secrets, call, enabledInDto };
  }

  const refusal = (names: string) => `In use by ${names}. Pick another model for them first.`;

  it.each(["bot", "routine", "backup"])(
    "keeps a working %s on another connection when saving this one",
    async (kind) => {
      const { call } = fixture({
        plaintext: secretText(["m-a"]),
        alternatePlaintext: secretText(["m-b"]),
        defaultModel: "m-a",
        bots: kind === "bot" ? [{ name: "Ada", modelId: "m-b" }] : [],
        routines: kind === "routine" ? [{ name: "Digest", modelId: "m-b" }] : [],
        backups: kind === "backup" ? ["m-b"] : [],
      });
      expect(
        (
          await call("models/connect", {
            provider: compatible,
            baseUrl,
            modelId: "m-a",
            enabledModelIds: ["m-a"],
          })
        ).status,
      ).toBe(200);
    },
  );

  it("keeps a thinking level on a newly enabled default judged by the saved secret", async () => {
    const { call, prisma } = fixture({
      plaintext: null,
      defaultModel: "m-z",
      thinkingLevel: "high",
    });

    const result = await call("models/connect", {
      provider: compatible,
      baseUrl,
      apiKey: "sk-fake-replacement-key",
      modelId: "m-z",
      enabledModelIds: ["m-z"],
      reasoning: true,
      thinkingLevel: "high",
    });

    expect(result.status).toBe(200);
    expect(prisma.userModelPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ modelId: "m-z", thinkingLevel: "high" }),
      }),
    );
  });

  it("accepts the same key replacement when the client lists the pinned id", async () => {
    const { call, secrets } = fixture({
      plaintext: null,
      defaultModel: "m-a",
      bots: [{ name: "Ada", modelId: "m-b" }],
    });

    const result = await call("models/connect", {
      provider: compatible,
      baseUrl,
      apiKey: "sk-fake-replacement-key",
      modelId: "m-a",
      enabledModelIds: ["m-b"],
    });

    expect(result.status).toBe(200);
    expect(secrets.put).toHaveBeenCalledOnce();
  });

  it("stores the new list with the default included when nothing pins a dropped id", async () => {
    const { call, secrets } = fixture({
      plaintext: secretText(["m-a", "m-c"]),
      defaultModel: "m-a",
    });

    const result = await call("models/connect", {
      provider: compatible,
      baseUrl,
      modelId: "m-a",
      enabledModelIds: ["m-b"],
    });

    expect(result.status).toBe(200);
    const saved = parseModelSecret(secrets.put.mock.calls[0]![0]);
    expect(saved).toMatchObject({ kind: "openai_compatible", enabledModelIds: ["m-a", "m-b"] });
  });

  it.each([secretText(["m-a"], false), secretText()])(
    "sets the default on the connection enabling the model, preserving its reasoning (%s)",
    async (plaintext) => {
      const { call, prisma } = fixture({
        plaintext,
        bots: [{ name: "Ada", modelId: "m-a" }],
        alternatePlaintext: secretText(["m-b"], true),
        defaultModel: "m-a",
      });
      expect(
        (
          await call("models/setDefault", {
            provider: compatible,
            modelId: "m-b",
            thinkingLevel: "high",
          })
        ).status,
      ).toBe(200);
      expect(prisma.userModelPreference.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_credentialId: {
              userId: actor.userId,
              credentialId: "cred-alternate",
            },
          },
          update: expect.objectContaining({ modelId: "m-b", thinkingLevel: "high" }),
        }),
      );
    },
  );

  it("lets the main model leave an implicit compatible default it alone uses", async () => {
    const { call } = fixture({
      plaintext: secretText(),
      defaultModel: "m-a",
      mainPrimary: "m-a",
    });
    expect((await call("models/setDefault", { provider: compatible, modelId: "m-b" })).status).toBe(
      200,
    );
  });

  it("refuses leaving an implicit compatible default another purpose still uses", async () => {
    const { call } = fixture({
      plaintext: secretText(),
      defaultModel: "m-a",
      mainPrimary: "m-a",
      roleChoices: ["m-a"],
    });
    expect(await call("models/setDefault", { provider: compatible, modelId: "m-b" })).toEqual({
      status: 400,
      message: refusal("backup models"),
    });
  });

  it("refuses setDefault to an id outside a listed secret", async () => {
    const { call, prisma } = fixture({
      plaintext: secretText(["m-a", "m-b"]),
      defaultModel: "m-a",
    });

    const result = await call("models/setDefault", { provider: compatible, modelId: "m-z" });

    expect(result).toEqual({ status: 400, message: "Unknown model for that provider" });
    expect(prisma.userModelPreference.upsert).not.toHaveBeenCalled();
  });

  it("switches A to B to A within the list while a bot pins B", async () => {
    const { call, state, enabledInDto } = fixture({
      plaintext: secretText(["m-a", "m-b"]),
      defaultModel: "m-a",
      bots: [{ name: "Ada", modelId: "m-b" }],
    });

    expect((await call("models/setDefault", { provider: compatible, modelId: "m-b" })).status).toBe(
      200,
    );
    expect(state.preference.modelId).toBe("m-b");
    expect((await call("models/setDefault", { provider: compatible, modelId: "m-a" })).status).toBe(
      200,
    );
    expect(state.preference.modelId).toBe("m-a");
    expect(enabledInDto()).toContain("m-b");
  });

  it.each([
    ["a same-space bot on another non-default id", { name: "Ada", modelId: "m-z" }],
    ["a bot in another space", { name: "Elsewhere", modelId: "m-w", spaceId: "space-2" }],
  ])("lets setDefault on a legacy secret ignore %s", async (_case, bot) => {
    const { call, state } = fixture({
      plaintext: secretText(),
      defaultModel: "m-a",
      bots: [bot],
    });

    const result = await call("models/setDefault", { provider: compatible, modelId: "m-x" });

    expect(result.status).toBe(200);
    expect(state.preference.modelId).toBe("m-x");
  });

  it("skips the pin check when the outgoing default stays in the stored list", async () => {
    const { call, prisma } = fixture({
      plaintext: secretText(["m-a", "m-x"]),
      defaultModel: "m-a",
      bots: [{ name: "Ada", modelId: "m-a" }],
    });

    const result = await call("models/setDefault", { provider: compatible, modelId: "m-x" });

    expect(result.status).toBe(200);
    expect(prisma.routine.findMany).not.toHaveBeenCalled();
  });

  it("re-activates a union-only compatible default while another provider is the space default", async () => {
    const { call, state } = fixture({
      plaintext: secretText(["m-x"]),
      defaultModel: "m-y",
      mainElsewhere: true,
    });

    const result = await call("models/setDefault", { provider: compatible, modelId: "m-y" });

    expect(result.status).toBe(200);
    expect(state.preference).toMatchObject({ modelId: "m-y" });
  });
});

describe("link favicons", () => {
  function faviconClient(actor: Actor | null) {
    const favicon = vi.fn().mockResolvedValue({ icon: "data:image/png;base64,AAAA" });
    const deps = {
      prisma: {} as PrismaClient,
      favicons: { favicon },
      env: { webOrigin: "http://127.0.0.1:5173", screenProxySecret: "fake-test-secret" },
      dataDir: "/tmp/labradoodle-router-test",
    } as unknown as RouterDeps;
    const client = createRouterClient(createRouter(deps), { context: { actor } });
    return { client, favicon };
  }

  const reader = {
    spaceId: "workspace-1",
    userId: "user-1",
    email: "user@labradoodle.test",
    isDeploymentOwner: false,
  } satisfies Actor;

  it("answers a signed-in reader with the resolved icon for an origin", async () => {
    const { client, favicon } = faviconClient(reader);
    await expect(client.links.favicon({ origin: "https://x.com" })).resolves.toEqual({
      icon: "data:image/png;base64,AAAA",
    });
    expect(favicon).toHaveBeenCalledWith("https://x.com");
  });

  it("passes a busy answer through so the client can ask again", async () => {
    const { client, favicon } = faviconClient(reader);
    favicon.mockResolvedValue({ icon: null, retry: true });
    await expect(client.links.favicon({ origin: "https://x.com" })).resolves.toEqual({
      icon: null,
      retry: true,
    });
  });

  it("accepts the longest origin a host name allows and nothing longer", async () => {
    const { client, favicon } = faviconClient(reader);
    // 253 characters: three 63-character labels and one 61-character label.
    const host = ["a".repeat(63), "b".repeat(63), "c".repeat(63), "d".repeat(61)].join(".");
    expect(host).toHaveLength(253);
    const longest = `https://${host}:65535`;
    await expect(client.links.favicon({ origin: longest })).resolves.toBeDefined();
    expect(favicon).toHaveBeenCalledWith(longest);
    await expect(client.links.favicon({ origin: `${longest}0` })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("refuses a request without a session before resolving anything", async () => {
    const { client, favicon } = faviconClient(null);
    await expect(client.links.favicon({ origin: "https://x.com" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(favicon).not.toHaveBeenCalled();
  });
});

describe("memory documents", () => {
  const actor = { userId: "user-1", spaceId: "space-1", email: "user@labradoodle.test" };

  function memoryClient(
    doc: { id: string; path: string; scope: string; botId: string | null } | null,
    session: typeof actor | null = actor,
  ) {
    const memoryDocument = { findFirst: vi.fn(async () => doc) };
    const memory = { remove: vi.fn(async () => ({ removed: true })) };
    const deps = {
      prisma: { memoryDocument },
      memory,
      env: { webOrigin: "https://example.test" },
    } as unknown as RouterDeps;
    const client = createRouterClient(createRouter(deps), { context: { actor: session } as never });
    return { client, memoryDocument, memory };
  }

  it("requires a session before looking up or deleting a document", async () => {
    const { client, memoryDocument, memory } = memoryClient(null, null);
    await expect(client.memory.remove({ documentId: "doc-1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(memoryDocument.findFirst).not.toHaveBeenCalled();
    expect(memory.remove).not.toHaveBeenCalled();
  });

  it("does not report success when the memory adapter fails", async () => {
    const { client, memory } = memoryClient({
      id: "doc-1",
      path: "projects/retired.md",
      scope: "user",
      botId: null,
    });
    memory.remove.mockRejectedValueOnce(new Error("Memory unavailable"));
    await expect(client.memory.remove({ documentId: "doc-1" })).rejects.toThrow(
      "Memory unavailable",
    );
  });

  it("keeps MEMORY.md and does not reach another user's document", async () => {
    const index = memoryClient({ id: "doc-1", path: "MEMORY.md", scope: "user", botId: null });
    await expect(index.client.memory.remove({ documentId: "doc-1" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(index.memory.remove).not.toHaveBeenCalled();

    const foreign = memoryClient(null);
    await expect(foreign.client.memory.remove({ documentId: "doc-2" })).rejects.toBeTruthy();
    expect(foreign.memory.remove).not.toHaveBeenCalled();
  });
});

describe("API-key live model catalog", () => {
  it.each([false, true])(
    "merges a fake provider probe and keeps saved selections (failure=%s)",
    async (fails) => {
      const bundled = listPiCatalog().filter((entry) => entry.provider === "openai");
      const retired = bundled[0]!.id;
      const saved = bundled[1]!.id;
      const liveOnly = "gpt-future-live-chat";
      const probe = vi.fn(async () => {
        if (fails) throw new Error("fake provider failure");
        return [...bundled.slice(2).map((entry) => entry.id), liveOnly, "text-embedding-future"];
      });
      const credential = {
        id: "credential-test",
        provider: "openai",
        secretId: "secret-test",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
      const prisma = {
        userModelCredential: { findMany: vi.fn(async () => [credential]) },
        userModelPreference: { findMany: vi.fn(async () => []) },
        secret: {
          findMany: vi.fn(async () => [{ id: "secret-test", ciphertext: "fake-ciphertext" }]),
        },
        bot: { findMany: vi.fn(async () => [{ modelProvider: "openai", modelId: saved }]) },
        routine: { findMany: vi.fn(async () => []) },
        userModelRoleChoice: { findMany: vi.fn(async () => []) },
        deploymentSettings: { findFirst: vi.fn(async () => null) },
      };
      const load = vi.fn(async () => "fake-api-key");
      const deps = {
        prisma,
        secrets: { load },
        providerCatalog: new adapters.ProviderCatalogCache({ enabled: true, probe }),
        env: { agentRuntime: "pi", defaultProvider: "fake", defaultModel: "fake" },
      } as unknown as RouterDeps;
      const actor = {
        userId: "user-test",
        spaceId: "space-test",
        email: "user@example.test",
        isDeploymentOwner: false,
      } satisfies Actor;
      const client = createRouterClient(createRouter(deps), { context: { actor } as never });
      const entries = await client.models.list();
      const openai = entries.filter((entry) => entry.provider === "openai");
      expect(openai.some((entry) => entry.id === retired)).toBe(fails);
      expect(openai.some((entry) => entry.id === saved)).toBe(true);
      expect(openai.some((entry) => entry.id === liveOnly)).toBe(!fails);
      expect(openai.some((entry) => entry.id === "text-embedding-future")).toBe(false);
      if (!fails)
        expect(openai.at(-1)).toMatchObject({
          provider: "openai",
          providerName: "OpenAI",
          id: liveOnly,
          label: liveOnly,
          auth: "api-key",
        });
      await client.models.list();
      expect(probe).toHaveBeenCalledTimes(1);
      expect(probe).toHaveBeenCalledWith(
        { provider: "openai", apiKey: "fake-api-key" },
        undefined,
        expect.any(AbortSignal),
      );
      expect(prisma.secret.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: actor.userId, spaceId: null }),
        }),
      );
    },
  );
});
