import type {
  AgentHomeStore,
  ArtifactStore,
  JobPublisher,
  MemoryStore,
  NotificationProvider,
  PaymentWalletProvider,
  ProductAnalytics,
  SandboxProvider,
  SecretStore,
  TransactionalEmailProvider,
} from "@labradoodle/adapter-kit";
import type {
  CloudAgentConnection,
  CodexLiveCatalog,
  ComposioProvider,
  ConnectorRegistry,
  FaviconResolver,
  IntegrationProviderSettings,
  McpConnector,
  McpOAuthBroker,
  MemoryProviderResolver,
  PiOAuthLogins,
  PluginRepoFetcher,
  PluginTextReader,
  ProviderCatalogCache,
  PushTokenStore,
  RemoteConnectorDependencies,
  verifyModelServesAgents,
} from "@labradoodle/adapters";
import type { Auth } from "@labradoodle/auth";
import type { NavLink } from "@labradoodle/contracts";
import type { PrismaClient, ThreadEvents } from "@labradoodle/db";
import { accountRoutes } from "./routes/account.js";
import { computerRoutes } from "./routes/computer.js";
import { computerProviderRoutes } from "./routes/computer-provider.js";
import { connectionsRoutes } from "./routes/connections.js";
import { contentRoutes } from "./routes/content.js";
import { createRouterContext } from "./routes/context.js";
import { doodleRoutes } from "./routes/doodle.js";
import { mcpRoutes } from "./routes/mcp.js";
import { memoryRoutes } from "./routes/memory.js";
import { modelsRoutes } from "./routes/models.js";
import { pagesRoutes } from "./routes/pages.js";
import { paymentWalletRoutes } from "./routes/payment-wallet.js";
import { routinesRoutes } from "./routes/routines.js";
import { spacesRoutes } from "./routes/spaces.js";
import { spendingLimitRoutes } from "./routes/spending-limit.js";
import { threadsRoutes } from "./routes/threads.js";
import type { VoiceDeps } from "./voice.js";

export { nextConnectionLabel } from "./model-credentials.js";
export { HEARTBEAT_MS, SESSION_RECHECK_MS } from "./routes/shared.js";

export interface RouterDeps {
  pushTokens: PushTokenStore;
  /** Push to phones; open apps hear the same alerts through `events`. */
  notifications?: NotificationProvider;
  analytics?: ProductAnalytics;
  cloudAgent?: CloudAgentConnection | null;
  /** The deployment's wallet provider; absent hides purchases. */
  paymentWallet?: PaymentWalletProvider | null;
  prisma: PrismaClient;
  events: ThreadEvents;
  auth: Auth;
  jobs: JobPublisher;
  sandbox: SandboxProvider;
  memory: MemoryStore;
  memoryProviders: MemoryProviderResolver;
  home: AgentHomeStore;
  secrets: SecretStore;
  oauthLogins: PiOAuthLogins;
  /** Live Codex catalog seam; defaults to the shared per-process cache. */
  codexCatalog?: CodexLiveCatalog;
  providerCatalog?: ProviderCatalogCache;
  /** HTTP transport for model connection checks and catalog probes. */
  modelConnectionFetch?: typeof fetch;
  /** One real request proving a newly keyed model can serve agents; absent skips it. */
  modelConnectionCheck?: typeof verifyModelServesAgents;
  /** Site icons for links; defaults to the per-process cache that fetches them. */
  favicons?: FaviconResolver;
  /** Detached refresh for an expired bearer, so the live catalog never refreshes inline. */
  refreshExpiredModelCredential?: (
    scope: { userId: string; spaceId: string },
    secretId: string,
    provider: string,
  ) => void;
  integrationSettings?: IntegrationProviderSettings;
  composio?: ComposioProvider;
  mcpOAuth?: McpOAuthBroker;
  /** Probes MCP server health; without it servers are never probed from here. */
  mcp?: Pick<McpConnector, "probe">;
  connectors: ConnectorRegistry;
  remoteConnectors?: RemoteConnectorDependencies;
  pluginRepoFetcher?: PluginRepoFetcher;
  pluginMarketplaceRead?: PluginTextReader;
  artifacts: ArtifactStore;
  dataDir: string;
  email?: TransactionalEmailProvider;
  onEmailError?: (error: unknown) => void;
  speechSummary?: VoiceDeps["speechSummary"];
  env: {
    navLinks?: NavLink[];
    adminEmails?: string[];
    maxUploadSizeBytes?: number;
    maxAttachmentsPerMessage?: number;
    agentRuntime: string;
    defaultProvider: string;
    defaultModel: string;
    deploymentModelConfigured?: boolean;
    deploymentModelHostCredentials?: boolean;
    webOrigin: string;
    privacyPolicyUrl?: string;
    screenProxySecret: string;
    sandboxProvider: string;
    gitSha?: string;
    integrationsCatalogUrl?: string;
    mcpAllowPrivateEndpoint?: boolean;
    desktopHostChoiceEnabled?: boolean;
    mcpStdioEnabled?: boolean;
    mcpStdioAllowedCommands?: string[];
  };
}

export function createRouter(deps: RouterDeps) {
  const ctx = createRouterContext(deps);
  const { os } = ctx;

  return os.router({
    ...accountRoutes(ctx),
    ...spacesRoutes(ctx),
    ...modelsRoutes(ctx),
    ...doodleRoutes(ctx),
    ...threadsRoutes(ctx),
    ...computerRoutes(ctx),
    ...computerProviderRoutes(ctx),
    ...memoryRoutes(ctx),
    ...routinesRoutes(ctx),
    ...mcpRoutes(ctx),
    ...connectionsRoutes(ctx),
    ...contentRoutes(ctx),
    ...pagesRoutes(ctx),
    ...paymentWalletRoutes(ctx),
    ...spendingLimitRoutes(ctx),
  });
}
