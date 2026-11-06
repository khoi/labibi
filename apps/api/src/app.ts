import { AsyncLocalStorage } from "node:async_hooks";
import { hostname } from "node:os";
import type {
  AgentContextStrategy,
  AgentRuntime,
  ConnectorProvider,
  JobPublisher,
  ManagedConnectorProvider,
  NotificationProvider,
  RealtimeFanout,
  SandboxProvider,
  TransactionalEmailProvider,
} from "@labradoodle/adapter-kit";
import {
  SandboxDamagedError,
  SandboxRateLimitError,
  SandboxUnavailableError,
  SandboxUnresponsiveError,
  VoiceAccountError,
} from "@labradoodle/adapter-kit";
import type {
  ComposioProvider,
  ConnectorRegistry,
  PluginRepoFetcher,
  PluginTextReader,
  RemoteConnectorDependencies,
  UserDeviceGateway,
} from "@labradoodle/adapters";
import {
  auditLogConfig,
  CodexCatalogCache,
  ComposioConnector,
  contentKeyProviderFromEnv,
  createAgentHomeStore,
  createArtifactStore,
  createAuditLogReconciler,
  createBackgroundJobHandlers,
  createCloudAgentConnection,
  createConnectorStack,
  createIdleComputerSweeper,
  createJobReconciler,
  createMediaGenerationProvider,
  createPaymentWalletProvider,
  createProductAnalytics,
  createRunExecutor,
  createRunSandbox,
  createRunSecretWriter,
  createSecretStore,
  createWebProvider,
  EmailEmulator,
  ExpoPushProvider,
  GraphileJobPublisher,
  InMemoryJobQueue,
  InMemoryRealtimeFanout,
  InstalledConnectorProvider,
  IntegrationProviderSettings,
  isComposioEnabled,
  isPipedreamEnabled,
  McpConnector,
  McpOAuthBroker,
  PiAgentRuntime,
  PiOAuthLogins,
  PipedreamConnector,
  PostgresRealtimeFanout,
  PrismaPushTokenStore,
  pipedreamConfigFromEnv,
  piSessionsRoot,
  RunJobPublisher,
  RunStarter,
  reconcileCloudAgents,
  reconcileComputerUpdates,
  reconcileMediaVideos,
  reconcilePurchases,
  removePiUserSessions,
  ScriptedAgentRuntime,
  SpaceMemoryProviderResolver,
  sandboxProviderOptionsFromEnv,
  UserDeviceHub,
  UserDevices,
  userDeviceForwardSecret,
  userDeviceInternalAddress,
  verifyModelServesAgents,
  withSecretPersistence,
} from "@labradoodle/adapters";
import type { DirectoryAccountChange } from "@labradoodle/auth";
import {
  CLIENT_IP_HEADER,
  createAuth,
  createDirectory,
  isBlockedAuthPath,
  loopbackTwinOrigins,
} from "@labradoodle/auth";
import type { Actor, AuthCapabilities } from "@labradoodle/contracts";
import {
  isLocalhostOrLoopbackIp,
  PLUGIN_SUBMISSIONS_PATH,
  SERVER_BUILD_HEADER,
} from "@labradoodle/contracts";
import { encryptionKeyWarning, signupPolicyFromEnv } from "@labradoodle/core";
import type { Pool, PrismaClient } from "@labradoodle/db";
import {
  configureProviderTransactionPool,
  createDb,
  createPool,
  createSecurityEventPruner,
  createThreadEvents,
  describeRowSecurity,
  IsolationError,
  installAuditEventStore,
  installSecurityEventStore,
  ProviderTransactionBusyError,
  parsePositiveInteger,
  pushSessionExpiresAt,
  requireMembership,
  rowSecurityWarning,
  runAsSystem,
  SpaceOwnerRequiredError,
  securityEventRetentionDays,
  verifyContentKeys,
} from "@labradoodle/db";
import type { Logger } from "@labradoodle/logging";
import {
  createServiceLogger,
  enrichLogContext,
  getLogger,
  installLogger,
  SERVICE_NAMES,
} from "@labradoodle/logging";
import { markExpectedFailure, requestLogging } from "@labradoodle/logging/hono";
import { MarkdownMemoryStore } from "@labradoodle/memory";
import { ORPCError, onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteAccountContent } from "./account-deletion.js";
import { mountAccountExportRoute } from "./account-export.js";
import { settleDirectoryChange } from "./account-status.js";
import { mountAppAssociation, nativePasskeys } from "./app-association.js";
import { mountAuditExportRoute } from "./audit-export.js";
import { clientBuildMiddleware, readDeployedWebBuild } from "./client-build.js";
import {
  clientIpMiddleware,
  createClientIpResolver,
  defaultTrustedProxies,
  requestClientIp,
  withClientIp,
} from "./client-ip.js";
import { cspReportRoutes } from "./csp-report.js";
import { configuredEmailProvider } from "./email.js";
import type { AppEnv } from "./env.js";
import { loadEnv } from "./env.js";
import { healthRoutes } from "./health.js";
import { trackInFlightRequests } from "./in-flight-requests.js";
import { mountLocalComputerHost } from "./local-settings.js";
import { marketingEmailRoutes, sendWelcomeEmail } from "./marketing-email.js";
import { moveMcpArgsIntoSecrets } from "./mcp-args-migration.js";
import { monitoringRoutes } from "./monitoring.js";
import { pluginSubmissionRoutes } from "./plugin-submissions.js";
import { mountApiRequestBodyLimits, rpcBodyLimit } from "./request-body-limit.js";
import { createRouter } from "./router.js";
import { mountScreenTarget } from "./screen-proxy.js";
import { mountScriptAssets } from "./script-assets.js";
import { createAuthResponseAudit } from "./security-audit.js";
import { mountSharedPages } from "./shared-pages.js";
import { createSpeechSummarizer } from "./speech-summary.js";
import { endUserDeviceSession, mountUserDeviceRoutes } from "./user-devices.js";
import { mountVoiceHttpRoutes, voiceAccountErrorStatus } from "./voice.js";
import { mountWebhookHttpRoutes } from "./webhook.js";

/**
 * Native clients always send the app scheme, including in Expo Go, so no
 * exp:// origin is trusted: it would accept any Expo host as a redirect target.
 * The loopback entries are the Expo web dev server.
 */
export const MOBILE_AUTH_ORIGINS = [
  "labradoodle://",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://localhost:19006",
  "http://127.0.0.1:19006",
];

// Deploys give the old API 30 seconds to stop before killing it.
const REQUEST_DRAIN_MS = 20_000;

export interface AppHandles {
  app: Hono;
  prisma: PrismaClient;
  jobs: JobPublisher;
  sandbox: SandboxProvider;
  composio?: ComposioProvider;
  connectors: ConnectorRegistry;
  email?: TransactionalEmailProvider;
  notifications: NotificationProvider;
  executor: ReturnType<typeof createRunExecutor>;
  runtime: AgentRuntime;
  awaitIdle?: () => Promise<void>;
  backgroundFailures?: () => Array<{ name: string; count: number }>;
  /** Node `upgrade` listener for desktop device sockets; absent when the feature is off. */
  handleUpgrade?: UserDeviceHub["handleUpgrade"];
  stop: () => Promise<void>;
}

// Startup and everything it schedules (pollers, team chat, the in-memory job
// queue, retries) runs across tenants. Requests start without a context and get
// one per route: tenant for signed-in procedures, system for auth and webhooks.
export function createApp(overrides: CreateAppOverrides = {}): Promise<AppHandles> {
  return runAsSystem("api startup and background work", () => buildApp(overrides));
}

type CreateAppOverrides = Partial<AppEnv> & {
  prisma?: PrismaClient;
  realtime?: RealtimeFanout;
  sandbox?: SandboxProvider;
  composio?: ComposioProvider;
  /** Test-only connector providers registered beside the configured ones. */
  connectors?: ConnectorProvider[];
  pipedream?: ManagedConnectorProvider;
  email?: TransactionalEmailProvider;
  notifications?: NotificationProvider;
  remoteConnectors?: RemoteConnectorDependencies;
  pluginRepoFetcher?: PluginRepoFetcher;
  pluginMarketplaceRead?: PluginTextReader;
  modelConnectionFetch?: typeof fetch;
  logger?: Logger;
  runtime?: AgentRuntime;
  contextStrategy?: AgentContextStrategy;
  /** Test-only stand-in for desktops connected to this server. */
  userDevices?: UserDeviceGateway;
  /** Test-only present moment the agent is told. */
  now?: () => Date;
};

async function buildApp(overrides: CreateAppOverrides): Promise<AppHandles> {
  const {
    prisma: prismaOverride,
    realtime: realtimeOverride,
    sandbox: sandboxOverride,
    composio: composioOverride,
    connectors: connectorOverrides = [],
    pipedream: pipedreamOverride,
    email: emailOverride,
    notifications: notificationsOverride,
    remoteConnectors,
    modelConnectionFetch,
    pluginRepoFetcher,
    pluginMarketplaceRead,
    logger: loggerOverride,
    runtime: runtimeOverride,
    contextStrategy,
    userDevices: userDevicesOverride,
    now,
    ...envOverrides
  } = overrides;
  const env = { ...loadEnv(process.env), ...envOverrides };
  const logger = loggerOverride ?? createServiceLogger({ service: SERVICE_NAMES.api });
  installLogger(logger);
  const poolMax = parsePositiveInteger(process.env.DB_POOL_MAX, 4);
  configureProviderTransactionPool(poolMax);
  const created = prismaOverride
    ? { prisma: prismaOverride, pool: undefined }
    : createDb(env.databaseUrl, {
        poolMax,
        applicationName: "labradoodle-api",
        keyProvider: contentKeyProviderFromEnv(),
        encryptContent: env.contentEncryption,
      });
  let { prisma } = created;
  // Built before anything listens, so a bad TRUSTED_PROXIES entry stops startup.
  const clientIp = createClientIpResolver({
    // Unset trusts the proxies a stack is built with: on loopback or on the API's own networks.
    // Trusting none would make the web proxy every client, one sign-in rate-limit bucket for all.
    trustedProxies: env.trustedProxies.length > 0 ? env.trustedProxies : defaultTrustedProxies(),
    header: env.clientIpHeader,
  });
  const rowSecurity = rowSecurityWarning(await describeRowSecurity(prisma));
  if (rowSecurity) logger.warn(rowSecurity);
  const weakEncryptionKey = encryptionKeyWarning(process.env);
  if (weakEncryptionKey) logger.warn(weakEncryptionKey);
  const realtime =
    realtimeOverride ??
    (created.pool
      ? new PostgresRealtimeFanout({
          connectionString: env.realtimeDatabaseUrl,
          publisher: created.pool,
        })
      : new InMemoryRealtimeFanout());
  const secrets = createSecretStore(env.encryptionKey, process.env, realtime);
  await secrets.start();
  if (secrets.describe().capabilities.degraded)
    logger.warn("Secret storage degraded; encrypted credentials remain available");
  prisma = withSecretPersistence(prisma, secrets);
  installSecurityEventStore(prisma);
  installAuditEventStore(prisma);
  const unreadableMasterKeys = await verifyContentKeys(prisma);
  if (unreadableMasterKeys.length)
    logger.error("Stored space keys need master keys that are not configured", undefined, {
      masterKeyIds: unreadableMasterKeys,
    });
  const analytics = createProductAnalytics();
  const events = createThreadEvents(prisma, realtime, {
    analytics,
    runSecretWriter: createRunSecretWriter(secrets),
  });
  const environmentSignupPolicy = signupPolicyFromEnv(env);
  // Mirror the env policy for the previous release during a rolling deploy.
  await prisma.deploymentSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      signupsEnabled: environmentSignupPolicy.enabled,
      signupAllowlist: environmentSignupPolicy.allowlist.join(","),
      signupPolicyInitialized: true,
    },
    update: {
      signupsEnabled: environmentSignupPolicy.enabled,
      signupAllowlist: environmentSignupPolicy.allowlist.join(","),
      signupPolicyInitialized: true,
    },
  });

  const jobKind = env.wakeupDriver;
  const inMemoryJobs = jobKind === "memory" ? new InMemoryJobQueue() : undefined;
  // prismaOverride skips createDb, so there is no shared pool; keep a bounded one for jobs.
  let ownedJobPool: Pool | undefined;
  if (!inMemoryJobs && !created.pool) {
    ownedJobPool = createPool(env.databaseUrl, {
      poolMax: parsePositiveInteger(process.env.DB_POOL_MAX, 4),
      applicationName: "labradoodle-api-jobs",
    });
  }
  const jobPool = created.pool ?? ownedJobPool;
  const shutdown = new AbortController();
  // Chat starts in the process that receives it; the worker only takes what this one can't.
  const runs = inMemoryJobs ? undefined : new RunStarter(realtime, { signal: shutdown.signal });
  const jobs =
    inMemoryJobs ??
    new RunJobPublisher(
      prisma,
      new GraphileJobPublisher(
        jobPool ??
          (() => {
            throw new Error("Graphile job publisher requires a PostgreSQL pool");
          })(),
        prisma,
      ),
      runs!,
    );
  const sandbox: SandboxProvider =
    sandboxOverride ??
    (await createRunSandbox(env.sandboxProvider, {
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
    }));
  const mcpOAuth = new McpOAuthBroker(
    prisma,
    secrets,
    remoteConnectors,
    env.mcpAllowPrivateEndpoint,
  );
  const memoryProviders = new SpaceMemoryProviderResolver(prisma, secrets);
  const oauthLogins = new PiOAuthLogins(undefined, { prisma, secrets });
  const home = createAgentHomeStore(env.dataDir, prisma);
  void home.removeStaleStaging().catch((error) => getLogger().error("home staging cleanup", error));
  const artifacts = createArtifactStore(env.dataDir, prisma);
  const memory = new MarkdownMemoryStore(prisma);
  const mcp = new McpConnector(
    prisma,
    secrets,
    {
      stdioEnabled: env.mcpStdioEnabled,
      allowedCommands: env.mcpStdioAllowedCommands,
      ...env.mcpStdio,
      network: remoteConnectors,
      events,
      allowPrivateEndpoint: env.mcpAllowPrivateEndpoint,
    },
    mcpOAuth,
  );
  const pipedreamConfig = pipedreamConfigFromEnv(env);
  const pipedream =
    pipedreamOverride ??
    (isPipedreamEnabled(pipedreamConfig) ? new PipedreamConnector(pipedreamConfig) : undefined);
  const configuredEmail = emailOverride ?? configuredEmailProvider(env);
  const localEmailEmulator =
    !configuredEmail && env.emailEmulator
      ? new EmailEmulator((message) => {
          getLogger().info("email emulator captured message", {
            "email.subject": message.subject,
          });
        })
      : undefined;
  if (localEmailEmulator && !isLocalhostOrLoopbackIp(env.apiHost)) {
    throw new Error("EMAIL_EMULATOR requires API_HOST to be a loopback host");
  }
  const email: TransactionalEmailProvider | undefined = configuredEmail ?? localEmailEmulator;
  const onEmailError = (error: unknown) =>
    getLogger().error("transactional email delivery failed", error);
  await prisma.deploymentSettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
  const installed = new InstalledConnectorProvider(
    prisma,
    secrets,
    remoteConnectors,
    env.mcpAllowPrivateEndpoint,
  );
  const integrationSettings = new IntegrationProviderSettings(prisma, secrets, env.encryptionKey, {
    composio:
      composioOverride ??
      (isComposioEnabled(env.composioApiKey)
        ? new ComposioConnector({ apiKey: env.composioApiKey })
        : undefined),
    pipedream,
  });
  const stack = createConnectorStack(composioOverride, [
    installed,
    ...integrationSettings
      .providers()
      .filter((provider) => !composioOverride || provider.describe().id !== "composio"),
    mcp,
    ...connectorOverrides,
  ]);
  integrationSettings.warmDirectories();
  const runtime =
    runtimeOverride ??
    (env.agentRuntime === "scripted"
      ? new ScriptedAgentRuntime()
      : new PiAgentRuntime({
          sessionRoot: env.piSessionRecording ? piSessionsRoot(env.dataDir) : undefined,
        }));
  const pushTokens = new PrismaPushTokenStore(prisma, env.encryptionKey);
  const notifications =
    notificationsOverride ??
    new ExpoPushProvider(pushTokens, {
      sessionExpiresAt: (sessionId) => pushSessionExpiresAt(prisma, sessionId),
      jobs,
      accessToken: env.expoAccessToken,
    });
  const userDeviceSecret = userDeviceForwardSecret(env.encryptionKey);
  const userDeviceHub = env.userDevicesEnabled
    ? new UserDeviceHub({ prisma, address: userDeviceInternalAddress(env.apiHost, env.port) })
    : undefined;
  const userDevices = userDeviceHub
    ? new UserDevices({ prisma, forwardSecret: userDeviceSecret, hub: userDeviceHub })
    : undefined;
  const deviceSessions = {
    prisma,
    devices: userDevices ?? new UserDevices({ prisma, forwardSecret: userDeviceSecret }),
  };
  // A SCIM request records the accounts it turned off or on; the route settles them after commit.
  const directoryChanges = new AsyncLocalStorage<DirectoryAccountChange[]>();
  const directory = env.scimBearerToken
    ? await createDirectory(prisma, {
        token: env.scimBearerToken,
        secret: env.authSecret,
        baseURL: env.authUrl,
        ipAddressHeader: CLIENT_IP_HEADER,
        logger: {
          level: "error",
          log: (_level, _message, ...args) =>
            getLogger().error(
              "directory.request.failed",
              args.find((arg) => arg instanceof Error),
            ),
        },
        onAccountChange: (change) => directoryChanges.getStore()?.push(change),
      })
    : undefined;
  const auth = createAuth(prisma, {
    directoryProvisioning: Boolean(directory),
    analytics,
    passwordAuth: env.passwordAuth,
    breachedPasswordCheck: env.breachedPasswordCheck,
    oidc: env.oidc,
    secret: env.authSecret,
    baseURL: env.authUrl,
    webOrigin: env.webOrigin,
    signupsEnabled: env.signupsEnabled,
    signupAllowlist: env.signupAllowlist,
    singleAccount: Boolean(env.desktopStackToken),
    email,
    logger: {
      level: "error",
      log: (_level, _message, ...args) =>
        getLogger().error(
          "auth.request.failed",
          args.find((arg) => arg instanceof Error),
        ),
    },
    onEmailError,
    afterSignIn:
      email && env.welcomeEmailEnabled
        ? (userId, headers) =>
            sendWelcomeEmail(
              {
                prisma,
                email,
                origin: env.authUrl,
                secret: env.authSecret,
                onError: (error) => getLogger().error("welcome email delivery failed", error),
              },
              userId,
              headers,
            )
        : undefined,
    extraOrigins: MOBILE_AUTH_ORIGINS,
    androidAppCertFingerprints: env.passkeyAndroidCertFingerprints,
    beforeDeleteUser: async (userId) => {
      await deleteAccountContent(
        {
          prisma,
          sandbox,
          home,
          jobs,
          artifacts,
          dataDir: env.dataDir,
          secrets,
          events,
        },
        userId,
      );
      await removePiUserSessions(env.dataDir, userId);
      await pushTokens
        .remove(userId)
        .catch((error) => getLogger().error("push token removal failed", error));
    },
    // The session change already happened, so a registration cleanup failure must not fail sign-out.
    afterDeleteSession: async (session) => {
      await pushTokens
        .endSession(session.userId, session.id)
        .catch((error) => getLogger().error("push token removal failed", error));
      await endUserDeviceSession(deviceSessions, session).catch((error) =>
        getLogger().error("user device revocation failed", error),
      );
    },
    afterReplaceSession: async (previous, session) => {
      await pushTokens
        .endSession(session.userId, previous.id, session.id)
        .catch((error) => getLogger().error("push token session update failed", error));
      await endUserDeviceSession(deviceSessions, previous, session).catch((error) =>
        getLogger().error("user device session update failed", error),
      );
    },
  });
  const oauthTokenUpgrade = auth
    .encryptStoredOAuthTokens()
    .catch((error) => getLogger().error("oauth token encryption upgrade failed", error));
  const mcpArgsMove = moveMcpArgsIntoSecrets(prisma, secrets, { signal: shutdown.signal })
    .then(({ moved }) => {
      if (moved) getLogger().info("mcp server arguments encrypted", { count: moved });
    })
    .catch((error) => {
      if (!shutdown.signal.aborted) getLogger().error("mcp server arguments move failed", error);
    });
  // One provider instance so emulator launches and polls share the same Map.
  const cloudAgent = createCloudAgentConnection({
    CLOUD_AGENT_PROVIDER: env.cloudAgentProvider,
    CURSOR_API_KEY: env.cursorApiKey,
    CLOUD_AGENT_SPACE_ID: env.cloudAgentSpaceId,
  });
  const paymentWallet = await createPaymentWalletProvider({
    PAYMENT_WALLET_PROVIDER: env.paymentWalletProvider,
    PAYMENT_WALLET_CLIENT_ID: env.paymentWalletClientId,
  });
  // One cache serves models.list, selection validation, and run-time model
  // resolution alike, so a list call warms the run path in this process.
  const codexCatalog = new CodexCatalogCache();
  // One instance: chat runs submit videos and, in single-process mode, background polls finish them.
  const mediaGeneration = createMediaGenerationProvider();
  const executor = createRunExecutor({
    maxUploadSizeBytes: env.maxUploadSizeBytes,
    mediaGeneration,
    contextStrategy,
    prisma,
    runtime,
    codexCatalog,
    sandbox,
    memory,
    memoryProviders,
    home,
    artifacts,
    connector: stack.connector,
    connectors: stack.connector,
    listConnectedPluginSlugs: async (userId) => {
      const provider = await integrationSettings.resolve("composio");
      if (!provider) return [];
      return provider.listConnectedExternalIds({
        userId,
        spaceId: "",
        operationId: "connections.sync",
        traceId: "connections.sync",
        signal: AbortSignal.timeout(15_000),
      });
    },
    secrets: [
      env.deploymentModelKey ?? "",
      env.composioApiKey ?? "",
      env.cursorApiKey ?? "",
      process.env.TYPESAFE_API_KEY ?? "",
    ].filter(Boolean),
    secretStore: secrets,
    secretHttp: remoteConnectors,
    mcpAllowPrivateEndpoint: env.mcpAllowPrivateEndpoint,
    deploymentModelKey: env.deploymentModelKey,
    deploymentModelConfigured: env.deploymentModelConfigured,
    dataDir: env.dataDir,
    notifications,
    jobs,
    events,
    web: createWebProvider(),
    cloudAgent,
    userDevices: userDevicesOverride ?? userDevices,
    paymentWallet,
    shutdownSignal: shutdown.signal,
    now,
  });

  const jobHandlers = createBackgroundJobHandlers({
    executor,
    prisma,
    sandbox,
    home,
    artifacts,
    jobs,
    events,
    // Every API container runs node as the same pid, and deploys run old and new side by side.
    workerId: `${hostname()}:${process.pid}`,
    runtime,
    notifications: notifications instanceof ExpoPushProvider ? notifications : undefined,
    secretStore: secrets,
    memoryProviders,
    deploymentModelKey: env.deploymentModelKey,
    deploymentModelConfigured: env.deploymentModelConfigured,
    cloudAgent,
    paymentWallet,
    mediaGeneration,
    maxUploadSizeBytes: env.maxUploadSizeBytes,
  });
  if (inMemoryJobs) {
    await inMemoryJobs.start(jobHandlers);
  }
  runs?.attach(jobHandlers);
  const reconciler = inMemoryJobs
    ? createJobReconciler({
        prisma,
        jobs,
        events,
        notifications,
        reconcileCloudAgents: () => reconcileCloudAgents({ prisma, jobs, cloudAgent }),
        reconcilePurchases: () => reconcilePurchases({ prisma, jobs, paymentWallet }),
        reconcileMediaVideos: () => reconcileMediaVideos({ prisma, jobs, mediaGeneration }),
        reconcileComputerUpdates: () => reconcileComputerUpdates({ prisma, jobs }),
        reconcileSecurityEventRetention: createSecurityEventPruner(
          prisma,
          securityEventRetentionDays(),
        ),
        reconcileAuditLog: createAuditLogReconciler(prisma, auditLogConfig()),
        reconcileIdleComputers: createIdleComputerSweeper({ prisma, jobs }),
      })
    : undefined;
  reconciler?.start();
  const router = createRouter({
    speechSummary:
      env.voiceSummaryMinChars === undefined
        ? undefined
        : {
            minChars: env.voiceSummaryMinChars,
            summarize: createSpeechSummarizer({
              prisma,
              runtime,
              resolveModel: executor.resolveModel,
            }),
          },
    analytics,
    pluginRepoFetcher,
    pluginMarketplaceRead,
    cloudAgent,
    paymentWallet,
    codexCatalog,
    prisma,
    pushTokens,
    notifications,
    events,
    auth,
    jobs,
    sandbox,
    memory,
    memoryProviders,
    home,
    secrets,
    oauthLogins,
    integrationSettings,
    mcpOAuth,
    mcp,
    composio: stack.composio,
    connectors: stack.connector,
    remoteConnectors,
    modelConnectionFetch,
    // The scripted runtime never calls a provider, so neither does its connect.
    modelConnectionCheck: env.agentRuntime === "pi" ? verifyModelServesAgents : undefined,
    artifacts,
    email,
    onEmailError,
    dataDir: env.dataDir,
    env: {
      navLinks: env.navLinks,
      startOver: env.nodeEnv === "development",
      adminEmails: env.adminEmails,
      maxUploadSizeBytes: env.maxUploadSizeBytes,
      maxAttachmentsPerMessage: env.maxAttachmentsPerMessage,
      agentRuntime: env.agentRuntime,
      defaultProvider: env.defaultProvider,
      defaultModel: env.defaultModel,
      deploymentModelConfigured: env.deploymentModelConfigured,
      deploymentModelHostCredentials: env.deploymentModelHostCredentials,
      webOrigin: env.webOrigin,
      privacyPolicyUrl: env.privacyPolicyUrl,
      screenProxySecret: env.screenProxySecret,
      sandboxProvider: env.sandboxProvider,
      gitSha: env.gitSha,
      integrationsCatalogUrl: env.integrationsCatalogUrl,
      mcpAllowPrivateEndpoint: env.mcpAllowPrivateEndpoint,
      desktopHostChoiceEnabled: Boolean(env.desktopStackToken),
      mcpStdioEnabled: env.mcpStdioEnabled,
      mcpStdioAllowedCommands: env.mcpStdioAllowedCommands,
    },
  });
  const rpc = new RPCHandler(router, {
    clientInterceptors: [onError((error, { path, signal }) => handleRpcError(error, path, signal))],
  });
  const app = new Hono();
  const inFlight = trackInFlightRequests();
  app.use("*", inFlight.middleware);
  app.use("*", requestLogging(logger));
  app.use("*", clientIpMiddleware(clientIp, env.clientIpHeader));
  app.use(
    "*",
    cors({
      origin: (origin, c) => {
        // Anyone may submit a plugin from any site; the endpoint reads no cookies.
        if (c.req.path === PLUGIN_SUBMISSIONS_PATH) return "*";
        if (!origin) return env.webOrigin;
        return isTrustedOrigin(origin, env) ? origin : "";
      },
      credentials: true,
      exposeHeaders: [SERVER_BUILD_HEADER],
    }),
  );
  // Session and account replies must never be stored by a client or an HTTP cache.
  for (const path of ["/api/auth/*", "/rpc/*"]) {
    app.use(path, async (c, next) => {
      await next();
      c.header("cache-control", "no-store");
    });
  }
  app.get("/api/auth/capabilities", (c) => {
    return c.json({
      sso: env.oidc
        ? { name: env.oidc.name, availability: auth.ssoAvailability() ?? "checking" }
        : null,
      passwordAuth: env.passwordAuth !== false,
      passwordReset: env.passwordAuth !== false && Boolean(email),
      resetUrl:
        env.passwordAuth !== false && email ? new URL("/reset-password", env.webOrigin).href : null,
      emailCode: auth.emailCodeSignIn,
      passkeyRpId: auth.passkeyRpId,
      nativePasskeys: nativePasskeys(env, auth.passkeyRpId),
    } satisfies AuthCapabilities);
  });
  mountAppAssociation(app, env);
  if (localEmailEmulator && env.nodeEnv === "development") {
    app.get(
      "/api/dev/emails",
      () =>
        new Response(JSON.stringify(localEmailEmulator.sent), {
          headers: { "cache-control": "no-store", "content-type": "application/json" },
        }),
    );
  }
  app.route(
    "/",
    monitoringRoutes(
      env.browserMonitoring,
      fetch,
      async (request) => (await auth.api.getSession({ headers: request.headers }))?.user.id,
    ),
  );
  app.route("/", cspReportRoutes(requestClientIp));
  app.route(
    "/",
    pluginSubmissionRoutes({
      prisma,
      email,
      adminEmails: env.adminEmails,
      webOrigin: env.webOrigin,
      clientIp: requestClientIp,
      onEmailError,
    }),
  );
  app.route("/", marketingEmailRoutes(prisma, env.authSecret));
  mountApiRequestBodyLimits(app);
  mountScreenTarget(app, prisma, env.screenProxySecret);
  mountScriptAssets(app);
  mountSharedPages(app, prisma, requestClientIp);
  const auditAuthResponse = createAuthResponseAudit();
  // Account and session tables, signup bootstrap and account deletion span tenants;
  // webhooks authenticate a bot or provider, then resolve the tenant from it.
  for (const [path, reason] of [
    ["/api/auth/*", "authentication"],
    ["/api/v1/bots/*", "bot webhook"],
  ] as const) {
    app.use(path, (_c, next) => runAsSystem(reason, next));
  }
  if (directory) {
    app.on(["GET", "POST", "PUT", "PATCH", "DELETE"], "/api/auth/scim/v2/*", async (c) => {
      const changes: DirectoryAccountChange[] = [];
      const response = await directoryChanges.run(changes, () =>
        directory.handler(withClientIp(c.req.raw, requestClientIp(c))),
      );
      // A retried write reports an account again; the last report per account stands.
      const latest = new Map(changes.map((change) => [change.userId, change]));
      let unfinished = false;
      for (const change of latest.values())
        await settleDirectoryChange(
          { prisma, pushTokens, devices: deviceSessions, events },
          change,
        ).catch((error) => {
          unfinished = true;
          // Sign-in and runs are already refused. A retried update finishes the rest; after a
          // delete, the operator's `account-status.js deactivate` does.
          getLogger().error("directory.account_change.unfinished", error, {
            "user.id": change.userId,
          });
        });
      if (unfinished) {
        // The directory change committed. Failing the request makes the provider retry it.
        return c.json(
          {
            schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
            status: "500",
            detail: "Could not finish the change; retry it",
          },
          500,
          { "content-type": "application/scim+json" },
        );
      }
      return response;
    });
  }
  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    const path = new URL(c.req.url).pathname.replace("/api/auth", "");
    if (isBlockedAuthPath(path)) {
      return c.json({ error: "Not available in version 1" }, 404);
    }
    const ip = requestClientIp(c);
    const response = await auth.handler(withClientIp(emptyAuthBodyAsJson(c.req.raw), ip));
    await auditAuthResponse(path, ip, response);
    return response;
  });
  mountLocalComputerHost(app, {
    token: env.desktopStackToken,
    sandboxProvider: env.sandboxProvider,
    prisma,
  });
  const requestSession = async (request: Request) => {
    // The bearer plugin turns a signed `Authorization: Bearer` into the session cookie.
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) return null;
    const actor = await actorFromMembership(
      requireMembership(
        prisma,
        session.user.id,
        request.headers.get("x-labradoodle-space-id"),
        session.session.id,
      ),
    );
    return actor && { actor, sessionId: session.session.id };
  };
  const sessionActor = async (request: Request) => (await requestSession(request))?.actor ?? null;
  if (userDeviceHub && userDevices) {
    mountUserDeviceRoutes(app, {
      prisma,
      hub: userDeviceHub,
      devices: userDevices,
      forwardSecret: userDeviceSecret,
      session: async (request) => {
        const found = await auth.api.getSession({ headers: request.headers });
        return found ? { userId: found.user.id, sessionId: found.session.id } : null;
      },
      trustedOrigin: (origin) => isTrustedOrigin(origin, env),
    });
  }
  app.use(
    "/rpc/*",
    clientBuildMiddleware({
      webBuild: readDeployedWebBuild(),
      minimums: env.minimumClientBuilds ?? {},
    }),
  );
  const limitRpcBody = rpcBodyLimit(env.maxUploadSizeBytes);
  app.use("/rpc/*", async (c, next) => {
    const session = await requestSession(c.req.raw);
    const actor = session?.actor ?? null;
    const tooLarge = await limitRpcBody(c, actor !== null);
    if (tooLarge) return tooLarge;
    if (actor) {
      enrichLogContext({ "user.id": actor.userId, "space.id": actor.spaceId });
    }
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: "/rpc",
      context: {
        actor,
        sessionId: session?.sessionId,
        signal: c.req.raw.signal,
        // Same user in the same space, so leaving the space also ends a stream.
        // A database failure rejects this check; only a missing membership is unauthorized.
        stillAuthorized: async () => {
          const current = await sessionActor(c.req.raw);
          return Boolean(
            actor && current?.userId === actor.userId && current.spaceId === actor.spaceId,
          );
        },
      },
    });
    if (matched) return c.newResponse(response.body, response);
    await next();
  });
  mountAccountExportRoute(app, { prisma, auth, artifacts, home });
  if (env.nodeEnv === "development") {
    app.post("/api/dev/start-over", async (c) => {
      if (c.req.header("content-type") !== "application/json") return c.text("Bad request", 400);
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session?.user) return c.text("Unauthorized", 401);
      await auth.startOver(session.user.id);
      return c.json({ ok: true });
    });
  }
  mountAuditExportRoute(app, { prisma, sessionActor });
  mountVoiceHttpRoutes(app, { prisma, secrets, env }, async (c) => {
    const actor = await sessionActor(c.req.raw);
    if (actor) enrichLogContext({ "user.id": actor.userId, "space.id": actor.spaceId });
    return actor;
  });
  mountWebhookHttpRoutes(app, { prisma, secrets, events, jobs });
  app.route(
    "/",
    healthRoutes(
      () => ({
        runtime: env.agentRuntime,
        sandbox: env.sandboxProvider,
        composio: Boolean(stack.composio),
        pipedream: Boolean(pipedream),
        email: email?.describe().id ?? null,
        jobs: jobKind,
        realtime: realtime.describe().id,
        secrets: secrets.describe(),
        degraded: secrets.describe().capabilities.degraded ?? false,
        revision: env.gitSha ?? null,
      }),
      // The statement timeout ends a stuck probe on the server too, freeing its connection.
      () =>
        prisma.$transaction([
          prisma.$executeRaw`SET LOCAL statement_timeout = 1500`,
          prisma.$queryRaw`SELECT 1`,
        ]),
    ),
  );

  return {
    app,
    prisma,
    jobs,
    sandbox,
    composio: stack.composio,
    connectors: stack.connector,
    email,
    notifications,
    executor,
    runtime,
    awaitIdle: inMemoryJobs ? () => inMemoryJobs.awaitIdle() : undefined,
    backgroundFailures: inMemoryJobs ? () => inMemoryJobs.failureCounts() : undefined,
    handleUpgrade: userDeviceHub?.handleUpgrade,
    stop: async () => {
      // Handlers still running would otherwise query the pool after it ends.
      const requestsSettled = settleWithTimeout(inFlight.settled(), REQUEST_DRAIN_MS);
      // Abort in-flight continueRun boot waits before draining jobs so stop() cannot sit
      // on waitForComputerReady for the full boot-wait window during shared Postgres journeys.
      auth.disposeOidcDiscovery();
      shutdown.abort();
      // Aborted runs hand themselves back while realtime is still open to announce them.
      const runsStopped = runs?.stop();
      await userDeviceHub?.close();
      oauthLogins.abortAll();
      await reconciler?.stop();
      await oauthTokenUpgrade;
      await mcpArgsMove;
      await runsStopped;
      await requestsSettled;
      await email?.drain?.();
      await jobs.close();
      await secrets.close();
      await realtime.close();
      await mcp.close();
      await installed.close();
      await prisma.$disconnect().catch(() => undefined);
      await created.pool?.end().catch(() => undefined);
      await ownedJobPool?.end().catch(() => undefined);
      await analytics?.flush();
      await logger.flush({ timeoutMs: 2_000 });
    },
  };
}

export function isTrustedOrigin(
  origin: string,
  env: Pick<AppEnv, "webOrigin" | "apiUrl" | "authUrl">,
) {
  if (!origin) return true;
  if (origin.startsWith("labradoodle://")) return true;
  const allowed = new Set(
    [env.webOrigin, env.apiUrl, env.authUrl, ...MOBILE_AUTH_ORIGINS].flatMap(originVariants),
  );
  return allowed.has(origin);
}

function originVariants(origin: string): string[] {
  if (!origin || origin === "labradoodle://") return [];
  const variants = [origin, ...loopbackTwinOrigins(origin)];
  try {
    const url = new URL(origin);
    if (url.protocol === "http:" || url.protocol === "https:") {
      variants.push(url.origin);
    }
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      const v6 = new URL(origin);
      v6.hostname = "[::1]";
      variants.push(v6.origin);
    }
  } catch {
    return variants;
  }
  return variants;
}

/**
 * No membership is no actor, which the RPC layer answers as 401. A database
 * failure, including the deployment-settings lookup, must stay a server error
 * so a blip does not look like a rejected session.
 */
export async function actorFromMembership(membership: Promise<Actor>): Promise<Actor | null> {
  try {
    return await membership;
  } catch (error) {
    if (error instanceof IsolationError) return null;
    throw error;
  }
}

/**
 * Some clients POST auth actions with an empty body (older phone sign-out, the web deletion code);
 * Better Auth rejects that before the endpoint runs.
 */
function emptyAuthBodyAsJson(request: Request) {
  if (
    request.method !== "POST" ||
    request.headers.get("content-length") !== "0" ||
    request.headers.has("transfer-encoding")
  ) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  return new Request(request, { headers, body: "{}" });
}

/**
 * Non-ORPCError failures are flattened into an opaque "Internal server error", so this log is
 * the only record of what broke. The cause chain matters: undici and most SDKs report a bare
 * "fetch failed" and keep the host and errno one level down.
 */
export function handleRpcError(
  error: unknown,
  path: readonly string[],
  signal?: AbortSignal,
): void {
  // A missing or foreign resource is the caller's mistake (a stale client, a deleted bot),
  // not a server failure, so it is a warning rather than an error report.
  if (error instanceof IsolationError) {
    getLogger().warn(`rpc ${path.join("/")} not found`, { "error.stack": error.stack });
    throw new ORPCError("NOT_FOUND", { message: error.message, cause: error });
  }
  if (error instanceof SpaceOwnerRequiredError) {
    throw new ORPCError("FORBIDDEN", { message: error.message, cause: error });
  }
  // The user's own voice account refused the request: theirs to fix.
  if (error instanceof VoiceAccountError) {
    getLogger().warn(`rpc ${path.join("/")} voice provider account rejected the request`, {
      reason: error.code ?? error.message,
    });
    throw new ORPCError(error.code ?? "FORBIDDEN", {
      status: voiceAccountErrorStatus(error.code),
      message: error.message,
      cause: error,
    });
  }
  // The computer provider did not start the computer in time, or could not be reached: an outage
  // on its side the user can retry, not a server failure.
  if (error instanceof SandboxUnavailableError || error instanceof SandboxUnresponsiveError) {
    const unavailable =
      error instanceof SandboxUnavailableError
        ? error
        : new SandboxUnavailableError({ cause: error });
    getLogger().warn(`rpc ${path.join("/")} computer unavailable`, {
      reason: unavailable.cause instanceof Error ? unavailable.cause.message : undefined,
    });
    markExpectedFailure();
    throw new ORPCError("SERVICE_UNAVAILABLE", { message: unavailable.message, cause: error });
  }
  // A provider kept another transaction busy past the wait; nothing failed, so the caller retries.
  if (error instanceof ProviderTransactionBusyError) {
    getLogger().warn(`rpc ${path.join("/")} provider transaction busy`);
    markExpectedFailure();
    throw new ORPCError("SERVICE_UNAVAILABLE", { message: error.message, cause: error });
  }
  if (error instanceof SandboxRateLimitError) {
    getLogger().warn(`rpc ${path.join("/")} computer rate limited`, {
      reason: error.cause instanceof Error ? error.cause.message : undefined,
    });
    throw new ORPCError("TOO_MANY_REQUESTS", { message: error.message, cause: error });
  }
  // A retry cannot fix a damaged computer; its message tells the user to Recover it.
  if (error instanceof SandboxDamagedError) {
    getLogger().warn(`rpc ${path.join("/")} computer damaged`);
    throw new ORPCError("CONFLICT", { message: error.message, cause: error });
  }
  // The client went away mid-request, so whatever failed next has no one waiting for it.
  if (signal?.aborted && !(error instanceof ORPCError)) {
    getLogger().warn(`rpc ${path.join("/")} client disconnected`, {
      reason: error instanceof Error ? error.message : String(error),
    });
    markExpectedFailure();
    return;
  }
  logUnexpectedRpcError(error, path);
}

export function logUnexpectedRpcError(error: unknown, path: readonly string[]): void {
  // A procedure's own 5xx (a store it depends on is down) would otherwise reach the collector
  // only as an anonymous failed request; report it under the procedure with its cause.
  if (error instanceof ORPCError && error.status < 500) return;
  const where = `rpc ${path.join("/")} failed`;
  getLogger().error(where, error);
}

function settleWithTimeout(
  task: Promise<unknown> | undefined,
  timeoutMs: number,
): Promise<"done" | "timeout"> {
  if (!task) return Promise.resolve("done");
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    task.then(
      () => "done" as const,
      () => "done" as const,
    ),
    new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
