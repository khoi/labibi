import * as z from "zod";
import { AGENT_SECRET_NAME_PATTERN } from "./agent-secret-name.js";
import { DisabledBuiltinToolsSchema } from "./builtin-tools.js";
import {
  cloudflareGatewayRoutingId,
  cloudflareModelConfigMessage,
  isCloudflareAiGatewayProvider,
  isCloudflareModelProvider,
} from "./cloudflare-ai-gateway.js";
import { MCP_OAUTH_CLIENT_REQUIRED } from "./connector-errors.js";
import { BotSettingsValuesSchema, ThreadMessageSchema } from "./events.js";
import { Id, MemoryScope, RunStatus, SandboxKind, ThinkingLevelSchema } from "./ids.js";
import {
  McpHeadersSchema,
  McpRemoteEndpointSchema,
  McpStdioFilesSchema,
  McpTransportSchema,
  parseMcpOAuthAuthorizationParams,
} from "./mcp.js";
import { ModelHeadersSchema } from "./model-headers.js";
import { NavLinkSchema } from "./nav-links.js";
import { RoutineWatchSchema, RoutineWatchStateSchema } from "./routine-watch.js";
import { RunTriggerSchema } from "./runs.js";

/**
 * Deprecated account-level setting kept for older app versions; the legacy settings endpoint
 * still always reports "organic".
 */
export const AvatarStyleSchema = z.enum(["robot", "organic"]);

/** True for an IANA timezone this runtime can format in, such as "Pacific/Auckland". */
export function isValidTimeZone(value: string): boolean {
  // Intl also accepts fixed offsets, which are not IANA timezone names.
  if (/^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Unknown timezone" });

/** An app language code, such as "es", "pt-BR" or "zh-TW". */
export const AppLocaleSchema = z.enum([
  "en",
  "de",
  "ko",
  "tr",
  "hi",
  "pt-BR",
  "zh-CN",
  "zh-TW",
  "es",
  "ru",
  "fr",
  "he",
  "nl",
  "ja",
  "pl",
]);
export type AvatarStyle = z.infer<typeof AvatarStyleSchema>;

export { AGENT_SECRET_NAME_PATTERN };

export const InstructionVersionSchema = z.object({
  id: Id,
  instructions: z.string(),
  reason: z.string(),
  createdAt: z.string(),
});

/** A workspace's Doodle. Everyone in the workspace reads it; only its owner may change it. */
export const DoodleSchema = z.object({
  id: Id,
  spaceId: Id,
  instructions: z.string(),
  instructionHistory: z.array(InstructionVersionSchema),
  voiceId: z.string().nullable(),
  modelProvider: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingLevel: ThinkingLevelSchema.nullable(),
  disabledBuiltinTools: z.array(z.string()),
  /** True only for the workspace's owner. */
  canCustomize: z.boolean(),
  updatedAt: z.string(),
});
export type Doodle = z.infer<typeof DoodleSchema>;

/** An alert the server also pushes to phones, already filtered by the chat's mute setting. */
export const ChatAlertSchema = z.object({
  kind: z.enum(["message", "completion", "failure", "help", "takeover"]),
  title: z.string(),
  body: z.string(),
  spaceId: Id,
  threadId: Id,
});
export type ChatAlert = z.infer<typeof ChatAlertSchema>;

/** Selected-text excerpt carried by a reply; capped so a quote stays a quote. */
export const REPLY_QUOTE_MAX_LENGTH = 2_000;

/** Cap an excerpt at the quote limit without splitting a surrogate pair. */
export function truncateReplyQuote(value: string): string {
  const truncated = value.slice(0, REPLY_QUOTE_MAX_LENGTH);
  const last = truncated.charCodeAt(truncated.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? truncated.slice(0, -1) : truncated;
}

export const CHAT_NAME_MAX_LENGTH = 80;
export const ChatNameSchema = z.string().trim().min(1).max(CHAT_NAME_MAX_LENGTH);

/** A person in a chat. Doodle is not one: `Chat.doodle` says whether it is in. */
export const ChatMemberSchema = z.object({
  userId: Id,
  name: z.string(),
  image: z.string().nullable(),
});
export type ChatMember = z.infer<typeof ChatMemberSchema>;

/** A chat as one of its people sees it. */
export const ChatSchema = z.object({
  /** The chat's thread id. */
  id: Id,
  spaceId: Id,
  name: z.string().nullable(),
  /** The name, else the fallback for this viewer (`chatTitle`); empty for a new chat with only them. */
  title: z.string(),
  doodle: z.boolean(),
  members: z.array(ChatMemberSchema),
  preview: z.string(),
  /** Doodle's activity here: its newest active run's status, or idle. */
  status: z.string(),
  unread: z.boolean(),
  muted: z.boolean(),
  /** Highest message seq this viewer has read; -1 when none. */
  lastReadSeq: z.number().int().min(-1),
  lastMessageAt: z.string(),
  createdAt: z.string(),
});
export type Chat = z.infer<typeof ChatSchema>;

/** A workspace in the switcher. */
export const WorkspaceSchema = z.object({
  id: Id,
  name: z.string(),
  isDefault: z.boolean(),
  /** The viewer owns it: may rename it, invite and remove people, and set up its Doodle. */
  isOwner: z.boolean(),
  /** More than one person belongs to it. */
  shared: z.boolean(),
  /** One of the viewer's chats here has something unread. */
  unread: z.boolean(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const SpaceRoleSchema = z.enum(["owner", "member"]);
export type SpaceRole = z.infer<typeof SpaceRoleSchema>;

export const SpaceMemberSchema = z.object({
  userId: Id,
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  role: SpaceRoleSchema,
});
export type SpaceMember = z.infer<typeof SpaceMemberSchema>;

export const SpaceMembersSchema = z.object({
  spaceName: z.string(),
  members: z.array(SpaceMemberSchema),
  /** True when the current member owns the space and may invite or remove people. */
  canManage: z.boolean(),
  /** For the owner: links created but not yet used or expired. */
  openInvites: z.number().int().nonnegative().optional(),
});
export type SpaceMembers = z.infer<typeof SpaceMembersSchema>;

export const SpaceInviteLinkSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string(),
});
export type SpaceInviteLink = z.infer<typeof SpaceInviteLinkSchema>;

export const SpaceInvitePreviewSchema = z.object({
  spaceId: Id,
  spaceName: z.string(),
  inviterName: z.string(),
  /** True when the signed-in person already belongs to the space. */
  alreadyMember: z.boolean(),
});
export type SpaceInvitePreview = z.infer<typeof SpaceInvitePreviewSchema>;

export const BOT_INSTRUCTIONS_MAX_LENGTH = 20000;

export const UpdateDoodleInput = z
  .object({
    instructions: z.string().trim().max(BOT_INSTRUCTIONS_MAX_LENGTH).optional(),
    expectedInstructions: z.string().max(BOT_INSTRUCTIONS_MAX_LENGTH).optional(),
    voiceId: z.string().max(120).nullable().optional(),
    modelProvider: z.string().trim().min(1).max(80).nullable().optional(),
    modelId: z.string().trim().min(1).max(200).nullable().optional(),
    thinkingLevel: ThinkingLevelSchema.nullable().optional(),
    disabledBuiltinTools: DisabledBuiltinToolsSchema.optional(),
    /** Write only while these settings still hold, as an undo does. */
    expectedSettings: BotSettingsValuesSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const providerProvided = value.modelProvider !== undefined;
    const modelProvided = value.modelId !== undefined;
    if (!providerProvided && !modelProvided) return;
    const bothNull = value.modelProvider === null && value.modelId === null;
    const bothSet = Boolean(value.modelProvider) && Boolean(value.modelId);
    if (providerProvided !== modelProvided || (!bothNull && !bothSet)) {
      ctx.addIssue({
        code: "custom",
        message: "Model provider and model id must both be set or both cleared",
        path: ["modelId"],
      });
    }
  });
export type UpdateDoodleInput = z.infer<typeof UpdateDoodleInput>;

/**
 * A routine's model is optional, but provider and id only mean something together,
 * and a thinking level belongs to a model this routine actually names.
 */
export function routineModelIssues(
  value: {
    modelProvider?: string | null;
    modelId?: string | null;
    thinkingLevel?: string | null;
  },
  ctx: { addIssue: (issue: { code: "custom"; message: string; path: string[] }) => void },
) {
  const providerProvided = value.modelProvider !== undefined && value.modelProvider !== null;
  const modelProvided = value.modelId !== undefined && value.modelId !== null;
  if (providerProvided !== modelProvided) {
    ctx.addIssue({
      code: "custom",
      message: "Model provider and model id must both be set or both cleared",
      path: ["modelId"],
    });
    return;
  }
  if (value.thinkingLevel && !providerProvided) {
    ctx.addIssue({
      code: "custom",
      message: "Pick a model for this routine first",
      path: ["thinkingLevel"],
    });
  }
}

export const RoutineSchema = z.object({
  id: Id,
  threadId: Id,
  name: z.string(),
  prompt: z.string(),
  crons: z.array(z.string()),
  timezone: z.string(),
  active: z.boolean(),
  notify: z.boolean(),
  webhookEnabled: z.boolean(),
  /** The routine has its own webhook secret. */
  webhookConfigured: z.boolean(),
  githubEnabled: z.boolean(),
  /** Null runs this routine on Doodle's model. */
  modelProvider: z.string().nullable(),
  modelId: z.string().nullable(),
  thinkingLevel: ThinkingLevelSchema.nullable(),
  /** Null unless the routine starts when something changes. */
  watch: RoutineWatchSchema.nullable(),
  watchState: RoutineWatchStateSchema.nullable(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  /** Computed by the server; absent on older servers. Not a worker-health diagnosis. */
  scheduleDelayed: z.boolean().optional(),
  createdAt: z.string(),
  /** Older servers send false for another member's routine; any member can now change it. */
  editable: z.boolean().optional(),
});
export type Routine = z.infer<typeof RoutineSchema>;

export const CreateRoutineInput = z
  .object({
    threadId: Id,
    name: z.string().min(1).max(80),
    prompt: z.string().min(1),
    crons: z.array(z.string().min(1)).default([]),
    timezone: TimeZoneSchema.default("UTC"),
    notify: z.boolean().default(true),
    active: z.boolean().default(false),
    webhookEnabled: z.boolean().default(false),
    githubEnabled: z.boolean().default(false),
    modelProvider: z.string().trim().min(1).max(80).nullable().default(null),
    modelId: z.string().trim().min(1).max(200).nullable().default(null),
    thinkingLevel: ThinkingLevelSchema.nullable().default(null),
    watch: RoutineWatchSchema.nullable().default(null),
  })
  .superRefine((value, ctx) => {
    routineModelIssues(value, ctx);
    if (value.crons.length === 0 && !value.webhookEnabled && !value.githubEnabled && !value.watch) {
      ctx.addIssue({
        code: "custom",
        message: "Add a schedule, webhook, GitHub, or change trigger",
        path: ["crons"],
      });
    }
    if (value.watch && value.crons.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "A change trigger checks on its own interval; remove the schedule",
        path: ["watch"],
      });
    }
  });
export type CreateRoutineInput = z.infer<typeof CreateRoutineInput>;

export const TaughtSkillStatusSchema = z.enum(["recording", "drafting", "draft", "saved"]);
export type TaughtSkillStatus = z.infer<typeof TaughtSkillStatusSchema>;

export const SkillPlaybookSchema = z.object({
  whenToUse: z.string(),
  inputs: z.array(z.string()),
  steps: z.array(z.string()),
  howToCheck: z.string(),
  whatToReturn: z.string(),
  approvalBoundaries: z.string(),
  failureHandling: z.string(),
});
export type SkillPlaybook = z.infer<typeof SkillPlaybookSchema>;

export const TeachRecordingEventSchema = z.object({
  at: z.string(),
  kind: z.enum(["pointer", "key", "clipboard", "snapshot", "scroll"]),
  x: z.number().optional(),
  y: z.number().optional(),
  button: z.string().optional(),
  type: z.string().optional(),
  key: z.string().optional(),
  text: z.string().optional(),
  summary: z.string().optional(),
  sensitive: z.boolean().optional(),
});
export type TeachRecordingEvent = z.infer<typeof TeachRecordingEventSchema>;

export const TeachSnapshotSchema = z.object({
  at: z.string(),
  summary: z.string(),
  hash: z.string().optional(),
});
export type TeachSnapshot = z.infer<typeof TeachSnapshotSchema>;

export const TeachRecordingSchema = z.object({
  events: z.array(TeachRecordingEventSchema),
  snapshots: z.array(TeachSnapshotSchema),
  controlLeaseId: z.string().optional(),
});
export type TeachRecording = z.infer<typeof TeachRecordingSchema>;

export const TaughtSkillSchema = z.object({
  id: Id,
  name: z.string(),
  goal: z.string(),
  status: TaughtSkillStatusSchema,
  playbook: SkillPlaybookSchema,
  recording: TeachRecordingSchema,
  startedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaughtSkill = z.infer<typeof TaughtSkillSchema>;

export const AgentSkillSourceSchema = z.enum(["user", "builtin", "plugin"]);
export type AgentSkillSource = z.infer<typeof AgentSkillSourceSchema>;

export const AgentSkillSchema = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  content: z.string(),
  source: AgentSkillSourceSchema,
  readOnly: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentSkill = z.infer<typeof AgentSkillSchema>;

export const AgentSkillCatalogEntrySchema = AgentSkillSchema.pick({
  id: true,
  name: true,
  description: true,
  source: true,
  readOnly: true,
});
export type AgentSkillCatalogEntry = z.infer<typeof AgentSkillCatalogEntrySchema>;

export const CreateAgentSkillInput = z
  .object({
    content: z.string().min(1).max(100_000).optional(),
    name: z.string().min(1).max(80).optional(),
    description: z.string().min(1).max(2000).optional(),
    body: z.string().max(100_000).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.content?.trim()) return;
    if (!input.name?.trim() || !input.description?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Provide content (SKILL.md) or name + description (+ optional body)",
        path: ["content"],
      });
    }
  });

export const UpdateAgentSkillInput = z
  .object({
    skillId: Id,
    content: z.string().min(1).max(100_000).optional(),
    name: z.string().min(1).max(80).optional(),
    description: z.string().min(1).max(2000).optional(),
    body: z.string().max(100_000).optional(),
  })
  .superRefine((input, ctx) => {
    if (
      input.content === undefined &&
      input.name === undefined &&
      input.description === undefined &&
      input.body === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Provide at least one field to update",
        path: ["content"],
      });
    }
  });

/** A chat's memory, shared by its people, or with no `threadId` the viewer's personal memory. */
export const MemoryDocumentSchema = z.object({
  id: Id,
  threadId: Id.nullable(),
  path: z.string(),
  content: z.string(),
  revision: z.number().int(),
  updatedAt: z.string(),
});
export type MemoryDocument = z.infer<typeof MemoryDocumentSchema>;

/** Which memory documents reach Doodle's prompt in a chat, and what did not fit. */
export const MemoryPromptDocumentUseSchema = z.object({
  scope: MemoryScope,
  path: z.string(),
  revision: z.number().int(),
  totalBytes: z.number().int().nonnegative(),
  includedBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type MemoryPromptDocumentUse = z.infer<typeof MemoryPromptDocumentUseSchema>;

export const MemoryPromptBudgetSchema = z.object({
  limitBytes: z.number().int().positive(),
  usedBytes: z.number().int().nonnegative(),
  documents: z.array(MemoryPromptDocumentUseSchema),
  omitted: z.array(MemoryPromptDocumentUseSchema),
});
export type MemoryPromptBudget = z.infer<typeof MemoryPromptBudgetSchema>;

/** Every chat and person keeps a MEMORY.md index; other memory documents can be deleted. */
export const MEMORY_INDEX_PATH = "MEMORY.md";
/** What Doodle may write to a memory. People can still write more by hand. */
export const BOT_MEMORY_MAX_BYTES = 4 * 1024;
export function isDeletableMemoryDocument(path: string): boolean {
  return path !== MEMORY_INDEX_PATH;
}

export const ConnectionSchema = z.object({
  id: Id,
  connectorId: z.string(),
  provider: z.string(),
  displayName: z.string(),
  status: z.enum(["pending", "connected", "revoked", "error"]),
  capabilities: z.array(z.string()),
  createdAt: z.string(),
});
export type Connection = z.infer<typeof ConnectionSchema>;

export const ConnectionCatalogItemSchema = z.object({
  connectorId: z.string(),
  slug: z.string(),
  name: z.string(),
  logo: z.string().nullable(),
  connected: z.boolean(),
  noAuth: z.boolean(),
});
export type ConnectionCatalogItem = z.infer<typeof ConnectionCatalogItemSchema>;

export const ActionApprovalRuleSchema = z.object({
  id: Id,
  effect: z.enum(["always_allow", "require_approval", "deny"]),
  matchKind: z.enum(["tool", "connector", "category", "site"]),
  matchValue: z.string(),
  createdAt: z.string(),
});
export type ActionApprovalRule = z.infer<typeof ActionApprovalRuleSchema>;

/** How much a space asks before acting. */
export const ApprovalModeSchema = z.enum(["never", "auto", "ask"]);
export type ApprovalMode = z.infer<typeof ApprovalModeSchema>;

export const ActionAutoReviewSettingsSchema = z.object({
  mode: ApprovalModeSchema,
  /** The stored form of `mode`, kept for clients that predate it. */
  enabled: z.boolean(),
  checkerAvailable: z.boolean(),
  skipApprovals: z.boolean(),
});
export type ActionAutoReviewSettings = z.infer<typeof ActionAutoReviewSettingsSchema>;

export const CapabilityInstallSchema = z.object({
  id: Id,
  kind: z.enum(["skill", "plugin", "mcp", "api", "graphql", "connection"]),
  name: z.string(),
  source: z.string(),
  version: z.string().nullable(),
  digest: z.string().nullable(),
  secretConfigured: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type CapabilityInstall = z.infer<typeof CapabilityInstallSchema>;

export const PluginPreviewSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** Paths of the reference files that install with the skill. */
  files: z.array(z.string()).optional(),
});
export const PluginPreviewMcpServerSchema = z.object({
  name: z.string(),
  transport: z.enum(["streamable_http", "sse"]),
  endpoint: z.string(),
  staticHeaderKeys: z.array(z.string()),
});
export const PluginPreviewSkippedSchema = z.object({
  kind: z.enum([
    "mcp_stdio",
    "mcp_invalid",
    "skill_invalid",
    "editor_only",
    "unsupported_transport",
    "unsupported_field",
  ]),
  name: z.string(),
  reason: z.string(),
});
export const PluginPreviewSchema = z.object({
  format: z.enum(["agent-plugins", "cursor", "grok"]),
  name: z.string(),
  version: z.string().nullable(),
  description: z.string(),
  author: z.string().nullable(),
  homepage: z.string().nullable(),
  repository: z.string().nullable(),
  license: z.string().nullable(),
  keywords: z.array(z.string()),
  resolvedSha: z.string().regex(/^[a-f0-9]{40}$/),
  /** Immutable source for confirming this preview, present on new API responses. */
  pinnedSource: z.string().optional(),
  /** The source an install of this preview is saved under. */
  installedSource: z.string().optional(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  skills: z.array(PluginPreviewSkillSchema),
  mcpServers: z.array(PluginPreviewMcpServerSchema),
  skipped: z.array(PluginPreviewSkippedSchema),
  /** Skills left out because a built-in skill has the same name; clients released before it ignore it. */
  builtinNames: z.array(z.string()).optional(),
});
export type PluginPreview = z.infer<typeof PluginPreviewSchema>;

/** A plugin installs as up to two independent parts: its MCP connector and its skills. */
export const PluginPartSchema = z.enum(["connector", "skills"]);
export type PluginPart = z.infer<typeof PluginPartSchema>;

export const PluginMarketplaceEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  category: z.string().nullable(),
  logo: z.string().nullable(),
  homepage: z.string().nullable(),
  domains: z.array(z.string()),
  registry: z.string(),
  source: z.string(),
  installedSource: z.string(),
  /** Whether installing adds a remote MCP connector; plugins without one are skill packs. */
  hasConnector: z.boolean(),
  /** Skills, sub-agents and commands, which all install as skills. */
  skillCount: z.number().int().nonnegative(),
});
export type PluginMarketplaceEntry = z.infer<typeof PluginMarketplaceEntrySchema>;
export const PluginMarketplaceCatalogSchema = z.object({
  entries: z.array(PluginMarketplaceEntrySchema),
  unavailableRegistries: z.array(z.string()),
  skippedEntries: z.number().int().nonnegative(),
});
export type PluginMarketplaceCatalog = z.infer<typeof PluginMarketplaceCatalogSchema>;

export const PLUGIN_SUBMISSIONS_PATH = "/api/v1/plugin-submissions";
/** Approved claims, public so the marketing site can show each owner's page at build time. */
export const INTEGRATION_CLAIMS_PATH = "/api/v1/integration-claims";
/** Opened from the email that proves a claimant reads mail at the app's domain. */
export const INTEGRATION_CLAIM_CONFIRM_PATH = "/api/v1/integration-claims/confirm";
export const SUBMIT_PLUGIN_URL = "https://labradoodle.com/plugins/submit/";
export const integrationPageUrl = (slug: string) => `https://labradoodle.com/integrations/${slug}/`;

/** People type a bare domain like `acme.com`, so a URL without a scheme gets `https://`. */
const HttpsUrlSchema = z
  .string()
  .trim()
  .transform((value) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`))
  .pipe(
    z
      .string()
      .max(2048)
      .url()
      .refine((value) => value.startsWith("https://"), "Use an https:// URL"),
  );

export const PluginSubmissionInputSchema = z.object({
  email: z.string().trim().max(254).email(),
  name: z.string().trim().min(1).max(80),
  website: HttpsUrlSchema.optional(),
  logo: HttpsUrlSchema,
  source: HttpsUrlSchema,
  description: z.string().trim().min(1).max(2000),
  testing: z.string().trim().min(1).max(4000),
  tested: z.literal(true),
});
export type PluginSubmissionInput = z.infer<typeof PluginSubmissionInputSchema>;

/** An app's owner claiming its integration page so it links to their site. */
export const IntegrationClaimInputSchema = z.object({
  /** The page's URL slug, as in `integrationPageUrl`. */
  claim: z
    .string()
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Use the page's URL slug"),
  email: z.string().trim().max(254).email(),
  name: z.string().trim().min(1).max(80),
  website: HttpsUrlSchema,
});
export type IntegrationClaimInput = z.infer<typeof IntegrationClaimInputSchema>;

export const IntegrationClaimSchema = z.object({
  slug: z.string(),
  website: z.string(),
});
export type IntegrationClaim = z.infer<typeof IntegrationClaimSchema>;

export const PluginSubmissionStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type PluginSubmissionStatus = z.infer<typeof PluginSubmissionStatusSchema>;

export const PluginSubmissionSchema = PluginSubmissionInputSchema.omit({ tested: true }).extend({
  id: z.string(),
  website: z.string().nullable(),
  logo: z.string().nullable(),
  source: z.string().nullable(),
  testing: z.string().nullable(),
  /** Empty for a claim, which only links the page. */
  description: z.string(),
  /** The integration page URL slug a claim is for; null for plugins. */
  claim: z.string().nullable(),
  status: PluginSubmissionStatusSchema,
  reason: z.string().nullable(),
  createdAt: z.string(),
  reviewedAt: z.string().nullable(),
});
export type PluginSubmission = z.infer<typeof PluginSubmissionSchema>;

export const PluginSubmissionReviewSchema = z.discriminatedUnion("decision", [
  z.object({ id: Id, decision: z.literal("approve") }),
  z.object({ id: Id, decision: z.literal("reject"), reason: z.string().trim().min(1).max(1000) }),
]);
export type PluginSubmissionReview = z.infer<typeof PluginSubmissionReviewSchema>;

export const IntegrationCatalogSurfaceSchema = z.object({
  kind: z.enum(["mcp", "openapi", "graphql", "cli"]),
  slug: z.string(),
  source: z.string().nullable(),
  auth: z
    .object({
      type: z.enum(["none", "bearer", "header"]),
      headerName: z.string().nullable(),
      note: z.string().nullable(),
    })
    .nullable(),
});
export type IntegrationCatalogSurface = z.infer<typeof IntegrationCatalogSurfaceSchema>;

export const IntegrationCatalogResultSchema = z.object({
  domain: z.string(),
  name: z.string(),
  description: z.string(),
  pageUrl: z.string().nullable(),
  surfaces: z.array(IntegrationCatalogSurfaceSchema),
});
export type IntegrationCatalogResult = z.infer<typeof IntegrationCatalogResultSchema>;

export type { McpTransport } from "./mcp.js";

const McpServerBaseInput = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  enabled: z.boolean().default(true),
  /** Keep this server's tool results whole instead of cutting them to fit context. Omitted keeps the stored value. */
  verbatimResults: z.boolean().optional(),
  /** Update-only: drop the stored static credential (secret/env/headers).
   * OAuth state survives so a connected server stays connected. */
  clearCredential: z.boolean().optional(),
});
const McpOAuthClientFields = {
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().min(1).max(4096).optional(),
  /** Space-separated scopes to request. Empty: the server's advertised scopes. */
  scope: z.string().trim().max(2000).optional(),
  /** Extra authorization request parameters in query-string form, e.g. Google's
   * `access_type=offline&prompt=consent` for a refresh token. */
  authorizationParams: z
    .string()
    .trim()
    .max(1000)
    .refine((value) => {
      try {
        parseMcpOAuthAuthorizationParams(value);
        return true;
      } catch {
        return false;
      }
    }, "Extra authorization parameters cannot set the OAuth flow's own parameters")
    .optional(),
};
/** A client registered with the server's OAuth provider out of band, for
 * providers without dynamic client registration. On update, omit it to keep
 * the stored client and send null to remove it. A remote server discovers its
 * authorization server, so the client is bound to it on first use. */
const McpOAuthClientInput = z.object(McpOAuthClientFields).nullable().optional();
/** A stdio server has no URL to discover from, so its client names the
 * authorization server (its issuer, e.g. https://accounts.google.com). Labradoodle
 * runs the OAuth flow and passes the grant through `{{oauth.*}}` env references. */
const McpStdioOAuthClientInput = z
  .object({ ...McpOAuthClientFields, authorizationServer: McpRemoteEndpointSchema })
  .nullable()
  .optional();
export const McpServerConfigInput = z.discriminatedUnion("transport", [
  McpServerBaseInput.extend({
    transport: z.literal("streamable_http"),
    endpoint: McpRemoteEndpointSchema,
    headers: McpHeadersSchema.default({}),
    secret: z.string().max(16384).optional(),
    oauthClient: McpOAuthClientInput,
  }),
  McpServerBaseInput.extend({
    transport: z.literal("sse"),
    endpoint: McpRemoteEndpointSchema,
    headers: McpHeadersSchema.default({}),
    secret: z.string().max(16384).optional(),
    oauthClient: McpOAuthClientInput,
  }),
  McpServerBaseInput.extend({
    transport: z.literal("stdio"),
    command: z.string().min(1).max(512),
    /** Update: send none to keep the stored arguments while the command is unchanged. */
    args: z.array(z.string().max(2048)).max(64).default([]),
    env: z
      .record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(4096))
      .superRefine((value, ctx) => {
        if (Object.keys(value).length > 32) {
          ctx.addIssue({ code: "custom", message: "At most 32 environment variables are allowed" });
        }
      })
      .default({}),
    /** Update: omit to keep the stored files, send the complete set to replace them. */
    files: McpStdioFilesSchema.optional(),
    secret: z.string().max(16384).optional(),
    oauthClient: McpStdioOAuthClientInput,
  }),
]);
export type McpServerConfigInput = z.infer<typeof McpServerConfigInput>;

/**
 * Last observed launch/discovery outcome of an MCP server. `installing` covers a stdio
 * package being prepared; `unknown` means nothing has tried to reach the server yet.
 */
export const McpServerHealthSchema = z.object({
  status: z.enum(["unknown", "installing", "ok", "error"]),
  /** Redacted, human-readable failure reason (stderr tail included for stdio). */
  message: z.string().nullable(),
  /** A failure the user fixes in the server's settings, so clients can say how. */
  code: z.enum([MCP_OAUTH_CLIENT_REQUIRED]).nullable().optional(),
  toolCount: z.number().int().nonnegative().nullable(),
  checkedAt: z.string().nullable(),
});
export type McpServerHealth = z.infer<typeof McpServerHealthSchema>;

export const McpServerSchema = z.object({
  id: Id,
  spaceId: Id,
  installId: Id.nullable().optional(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  transport: McpTransportSchema,
  endpoint: z.string().url().nullable(),
  command: z.string().nullable(),
  /** Arguments are stored encrypted and never returned. */
  hasArgs: z.boolean(),
  envKeys: z.array(z.string()),
  /** Env variables that receive a credential file's path instead of a value. */
  fileKeys: z.array(z.string()),
  headerKeys: z.array(z.string()),
  hasSecret: z.boolean(),
  oauthStatus: z.enum(["none", "connected", "reconnect"]),
  /** The pre-registered OAuth client, when one is configured. Its secret is never returned. */
  oauthClientId: z.string().nullable(),
  health: McpServerHealthSchema,
  enabled: z.boolean(),
  /** Keep this server's tool results whole instead of cutting them to fit context. */
  verbatimResults: z.boolean().default(false),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type McpServer = z.infer<typeof McpServerSchema>;

export const ArtifactSchema = z.object({
  id: Id,
  threadId: Id,
  runId: Id.nullable(),
  name: z.string(),
  description: z.string().nullable(),
  mimeType: z.string(),
  size: z.number().int(),
  version: z.number().int(),
  createdAt: z.string(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

export const ArtifactVersionSchema = z.object({
  id: Id,
  version: z.number().int(),
  name: z.string(),
  createdAt: z.string(),
});

export type ArtifactVersion = z.infer<typeof ArtifactVersionSchema>;

export const ArtifactWithContentSchema = ArtifactSchema.extend({
  contentBase64: z.string(),
});
export type ArtifactWithContent = z.infer<typeof ArtifactWithContentSchema>;

export const UsageRecordSchema = z.object({
  id: Id,
  botId: Id.nullable(),
  runId: Id.nullable(),
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  cacheReadTokens: z.number().int().nullable().optional(),
  cacheWriteTokens: z.number().int().nullable().optional(),
  cacheWrite1hTokens: z.number().int().nullable().optional(),
  reasoningTokens: z.number().int().nullable().optional(),
  totalTokens: z.number().int().nullable().optional(),
  costUsd: z.number().nonnegative().nullable().optional(),
  costSource: z.string().nullable().optional(),
  pricingVersion: z.string().nullable().optional(),
  usageSource: z.string().nullable().optional(),
  callId: z.string().nullable().optional(),
  operationId: z.string().nullable().optional(),
  operationKind: z.enum(["answer", "setup", "retrieval", "subagent", "compaction"]).optional(),
  parentRunId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  createdAt: z.string(),
});

/** Token and cost totals are null when any counted call lacks that figure. */
const UsageTotalsSchema = z.object({
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable().optional(),
  costUsd: z.number().nullable().optional(),
  modelCalls: z.number().optional(),
});
export const UsageSummarySchema = UsageTotalsSchema.extend({
  runs: z.number(),
  models: z
    .array(UsageTotalsSchema.required().extend({ provider: z.string(), model: z.string() }))
    .optional(),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

export const COMPUTER_UPDATE_STAGES = [
  "preparing",
  "saving",
  "recreating",
  "restoring",
  "reconnecting",
] as const;
export const ComputerUpdateSchema = z.object({
  canReleaseReservation: z.boolean().optional(),
  action: z.enum(["update", "recover"]),
  id: Id,
  status: z.enum(["queued", "running", "interrupted", "completed", "failed"]),
  stage: z.enum(COMPUTER_UPDATE_STAGES),
});
export type ComputerUpdate = z.infer<typeof ComputerUpdateSchema>;

/** The viewer's own computer in the workspace; nobody else watches or takes it over. */
export const ComputerStatusSchema = z.object({
  kind: SandboxKind,
  state: z.enum(["stopped", "booting", "running", "suspended", "error"]),
  controlHolder: z.enum(["bot", "user", "none"]),
  takeoverRequested: z.boolean(),
  screenAvailable: z.boolean(),
  screenWidth: z.number().int().positive(),
  screenHeight: z.number().int().positive(),
  homeRevision: z.string().nullable(),
  canUpdate: z.boolean(),
  terminalAvailable: z.boolean(),
  /** Set only while the user should see that the disk is nearly full. */
  diskFullPercent: z.number().int().min(0).max(100).optional(),
});
export type ComputerStatus = z.infer<typeof ComputerStatusSchema>;

export const ComputerReleaseReasonSchema = z.enum(["done", "skipped"]);
export type ComputerReleaseReason = z.infer<typeof ComputerReleaseReasonSchema>;

export const RunSchema = z.object({
  id: Id,
  userId: Id.optional(),
  botId: Id,
  threadId: Id,
  taskId: Id,
  status: RunStatus,
  trigger: RunTriggerSchema,
  routineId: Id.nullable(),
  modelProvider: z.string().nullable(),
  modelId: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Run = z.infer<typeof RunSchema>;

export const ThreadMessagePageSchema = z.object({
  threadId: Id,
  messages: z.array(ThreadMessageSchema),
  olderCursor: z.number().int().nonnegative().nullable(),
  coveredThroughSeq: z.number().int().nonnegative().optional(),
});
export type ThreadMessagePage = z.infer<typeof ThreadMessagePageSchema>;

export const ThreadSnapshotSchema = z.object({
  threadId: Id,
  cursor: z.number().int().min(-1),
  messages: z.array(ThreadMessageSchema),
  olderCursor: z.number().int().nonnegative().nullable(),
  chat: ChatSchema,
  run: RunSchema.nullable(),
  activeRuns: z.array(RunSchema).optional(),
  computer: ComputerStatusSchema.optional(),
});
export type ThreadSnapshot = z.infer<typeof ThreadSnapshotSchema>;

/** Default maximum number of completion tokens for an OpenAI-compatible connection. */
export const DEFAULT_MODEL_MAX_TOKENS = 4_096;

/** Fallback context window for OpenAI-compatible connections that do not report a size (e.g. Ollama, LM Studio, vLLM). */
export const DEFAULT_MODEL_CONTEXT_WINDOW = 262_144;

export const MAX_MODEL_CONTEXT_WINDOW = 2_147_483_647;

/**
 * Output limits follow the model; the only fixed bound is the context ceiling, and a connection's
 * limit must still leave room for input (`modelOutputLeavesInputRoom`).
 */
export const MAX_MODEL_MAX_TOKENS = MAX_MODEL_CONTEXT_WINDOW;
export function parseModelMaxImagesPerPrompt(
  value: string,
  supportsImages = true,
): number | undefined {
  if (!supportsImages) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000 ? parsed : undefined;
}

export function parseModelMaxTokens(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_MODEL_MAX_TOKENS
    ? parsed
    : undefined;
}

export function parseModelContextWindow(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_MODEL_CONTEXT_WINDOW
    ? parsed
    : undefined;
}

/**
 * JS null/undefined stringifies to the literals "null" / "undefined". Those
 * are not catalog ids; treat them (and blank values) as unset.
 */
export function usableModelId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  return trimmed;
}

/** Connection-declared capabilities; omission means unknown, not a provider default. */
export const CacheCapabilitiesSchema = z.object({
  retentionMs: z.number().int().positive().max(2147483647).optional(),
  minimumTokens: z.number().int().nonnegative().max(2147483647).optional(),
  scope: z.enum(["account", "connection"]),
  retentionMode: z.enum(["none", "short", "long"]).optional(),
  inputCostPerMillion: z.number().nonnegative().optional(),
  readCostPerMillion: z.number().nonnegative().optional(),
  writeCostPerMillion: z.number().nonnegative().optional(),
});
export type CacheCapabilities = z.infer<typeof CacheCapabilitiesSchema>;

export const ModelContextLimitsSchema = z.object({
  cacheCapabilities: CacheCapabilitiesSchema.optional(),
  contextWindow: z.number().int().min(1).max(MAX_MODEL_CONTEXT_WINDOW).optional(),
});
export type ModelContextLimits = z.infer<typeof ModelContextLimitsSchema>;

/** A completion limit must leave capacity for at least one input token. */
export function modelOutputLeavesInputRoom(
  maxTokens: number | null | undefined,
  contextWindow: number | undefined,
): boolean {
  return typeof maxTokens !== "number" || contextWindow === undefined || maxTokens < contextWindow;
}

/** Wire protocol selected for one OpenAI-compatible connection. */
export const ModelApiProtocolSchema = z.enum([
  "chat-completions",
  "responses",
  "anthropic-messages",
]);
export type ModelApiProtocol = z.infer<typeof ModelApiProtocolSchema>;

export const ModelCredentialSchema = z.object({
  /** Computed space preference order; credentials themselves remain newest first. */
  preferenceRank: z.number().int().nonnegative().optional(),
  ...ModelContextLimitsSchema.shape,
  id: Id,
  provider: z.string(),
  label: z.string(),
  hasKey: z.boolean(),
  isDefault: z.boolean(),
  headerNames: z.array(z.string()).optional(),
  baseUrl: z.string().optional(),
  apiProtocol: ModelApiProtocolSchema.optional(),
  accountId: z.string().optional(),
  gatewayId: z.string().optional(),
  modelId: z.string().optional(),
  reasoning: z.boolean().optional(),
  thinkingLevel: ThinkingLevelSchema.nullable().optional(),
  maxTokens: z.number().int().min(1).max(MAX_MODEL_MAX_TOKENS).optional(),
  supportsImages: z.boolean().optional(),
  maxImagesPerPrompt: z.number().int().min(1).max(1000).optional(),
  thinkingLevels: z.array(ThinkingLevelSchema).optional(),
  /** Openai-compatible only; always contains `modelId` when set. */
  enabledModelIds: z.array(z.string()).optional(),
  /** The connection's enabled models that accept images, where it declares them per model. */
  visionModelIds: z.array(z.string()).optional(),
  /** Stored secret kind. Absent when the secret could not be read. */
  authKind: z.enum(["api_key", "oauth", "openai_compatible"]).optional(),
  /**
   * The subscription sign-in was rejected. The stored tokens are gone and the
   * owner has to sign in again. Model choices on this connection are kept.
   */
  reconnectRequired: z.boolean().optional(),
});
export type ModelCredential = z.infer<typeof ModelCredentialSchema>;

export const MAX_MODEL_BACKUPS = 10;
export const ModelBackupChoiceSchema = z.object({
  provider: z.string().trim().min(1).max(128),
  modelId: z.string().trim().min(1).max(512),
});
export type ModelBackupChoice = z.infer<typeof ModelBackupChoiceSchema>;
/** At most MAX_MODEL_BACKUPS choices, each model once. */
export function modelChoiceListSchema<T extends z.ZodType<ModelBackupChoice>>(choice: T) {
  return z
    .array(choice)
    .max(MAX_MODEL_BACKUPS)
    .superRefine((choices, ctx) => {
      const seen = new Set<string>();
      for (const [index, choice] of choices.entries()) {
        // The same model may run on two connections, so a pinned connection is part of it.
        const credentialId = (choice as { credentialId?: string | null }).credentialId ?? null;
        const key = JSON.stringify([choice.provider, choice.modelId, credentialId]);
        if (seen.has(key)) {
          ctx.addIssue({
            code: "custom",
            message: "Backup models must be unique",
            path: [index],
          });
        }
        seen.add(key);
      }
    });
}
export const ModelBackupListSchema = modelChoiceListSchema(ModelBackupChoiceSchema);

export const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible";

export const MAX_ENABLED_MODEL_IDS = 500;

/** An existing connection's id, null for a new one, or omitted for the provider's newest. */
export const ModelConnectionTargetSchema = Id.nullable().optional();

export const MAX_MODEL_CONNECTION_LABEL = 80;
export const ModelConnectionLabelSchema = z.string().trim().min(1).max(MAX_MODEL_CONNECTION_LABEL);

export const CONNECTION_LABEL_MAX_LENGTH = 80;

export const ModelConnectInputSchema = z
  .object({
    ...ModelContextLimitsSchema.shape,
    provider: z.string(),
    apiKey: z.string().optional(),
    accountId: z.string().optional(),
    gatewayId: z.string().optional(),
    headers: ModelHeadersSchema.optional(),
    baseUrl: z.string().optional(),
    apiProtocol: ModelApiProtocolSchema.optional(),
    label: z.string().optional(),
    /**
     * The connection this save updates; null adds another connection for the provider.
     * Older apps omit it and update the provider's newest connection.
     */
    credentialId: ModelConnectionTargetSchema,
    modelId: z.string().optional(),
    reasoning: z.boolean().optional(),
    thinkingLevel: ThinkingLevelSchema.nullable().optional(),
    /** False keeps the current main model; omitted means true. */
    makeDefault: z.boolean().optional(),
    maxTokens: z.number().int().min(1).max(MAX_MODEL_MAX_TOKENS).nullable().optional(),
    supportsImages: z.boolean().optional(),
    maxImagesPerPrompt: z.number().int().min(1).max(1000).nullable().optional(),
    enabledModelIds: z
      .array(z.string().trim().min(1).max(512))
      .max(MAX_ENABLED_MODEL_IDS)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!modelOutputLeavesInputRoom(value.maxTokens, value.contextWindow)) {
      ctx.addIssue({
        code: "custom",
        message: "Maximum output tokens must leave room for input",
        path: ["maxTokens"],
      });
    }
    if (isCloudflareModelProvider(value.provider)) {
      if (value.accountId !== undefined && !cloudflareGatewayRoutingId(value.accountId)) {
        ctx.addIssue({
          code: "custom",
          message: cloudflareModelConfigMessage(value.provider),
          path: ["accountId"],
        });
      }
      if (
        isCloudflareAiGatewayProvider(value.provider) &&
        value.gatewayId !== undefined &&
        !cloudflareGatewayRoutingId(value.gatewayId)
      ) {
        ctx.addIssue({
          code: "custom",
          message: cloudflareModelConfigMessage(value.provider),
          path: ["gatewayId"],
        });
      }
    }
    if (value.provider === OPENAI_COMPATIBLE_PROVIDER_ID) {
      if (!value.baseUrl?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "Base URL is required for OpenAI-compatible models",
          path: ["baseUrl"],
        });
      }
      if (!value.modelId?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "Model id is required for OpenAI-compatible models",
          path: ["modelId"],
        });
      }
      return;
    }
    const apiKey = value.apiKey?.trim() ?? "";
    if (apiKey.length > 0 && apiKey.length < 8) {
      ctx.addIssue({
        code: "custom",
        message: "API key must contain at least 8 characters",
        path: ["apiKey"],
      });
    }
    // An existing connection can update its output limit without a new key.
    if (!apiKey && value.maxTokens === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "API key must contain at least 8 characters",
        path: ["apiKey"],
      });
    }
  });
export type ModelConnectInput = z.infer<typeof ModelConnectInputSchema>;

export const ModelOAuthSignInModeSchema = z.enum(["device-code", "auth-url"]);
export type ModelOAuthSignInMode = z.infer<typeof ModelOAuthSignInModeSchema>;

const ModelOAuthBeginBaseSchema = z.object({
  loginId: z.string(),
  provider: z.string(),
  verificationUri: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), "Expected an HTTPS authorization URL"),
  expiresInSeconds: z.number().int().positive(),
});

export const ModelOAuthBeginSchema = z.discriminatedUnion("mode", [
  ModelOAuthBeginBaseSchema.extend({
    mode: z.literal("device-code"),
    userCode: z.string().min(1),
  }),
  ModelOAuthBeginBaseSchema.extend({ mode: z.literal("auth-url") }),
]);
export type ModelOAuthBegin = z.infer<typeof ModelOAuthBeginSchema>;

export const SpaceMemoryConfigSchema = z.object({
  provider: z.string(),
  settings: z.record(z.string(), z.string()),
  updatedAt: z.string(),
});
export type SpaceMemoryConfig = z.infer<typeof SpaceMemoryConfigSchema>;

export const ModelCatalogEntrySchema = z.object({
  /** Omitted by older servers and ordinary chat connections. */
  protocol: z.enum(["chat", "decisions"]).optional(),
  /** Preselected for a new connection when there is no saved model choice. */
  recommended: z.boolean().optional(),
  /** The provider's connections that can run it, when not all of them can. */
  credentialIds: z.array(z.string()).optional(),
  provider: z.string(),
  providerName: z.string().optional(),
  id: z.string(),
  label: z.string(),
  billing: z.string(),
  auth: z.enum(["api-key", "oauth", "both"]).optional(),
  oauthLabel: z.string().optional(),
  authHint: z.string().optional(),
  subscription: z.boolean().optional(),
  signIn: ModelOAuthSignInModeSchema.optional(),
  reasoning: z.boolean().optional(),
  thinkingLevels: z.array(ThinkingLevelSchema).optional(),
  /** The model reads images. Left out where a connection setting decides it. */
  images: z.boolean().optional(),
  /** Catalog stand-in so a provider appears before the user enters a real model id. */
  placeholder: z.boolean().optional(),
  /** Models share one pinned HTTPS models-list URL that can be probed. */
  catalogProbe: z.boolean().optional(),
  /** Listed by the provider's live models list but not in the bundled catalog. */
  live: z.literal(true).optional(),
});
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;

export const VoiceCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  transcribe: z.boolean(),
  keyless: z.boolean().optional(),
});
export type VoiceCatalogEntry = z.infer<typeof VoiceCatalogEntrySchema>;

export const VoiceInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type VoiceInfo = z.infer<typeof VoiceInfoSchema>;

export const VoiceCredentialSchema = z.object({
  id: Id,
  provider: z.string(),
  hasKey: z.boolean(),
  isDefault: z.boolean(),
  voiceId: z.string(),
  /** Fish speech-model override. Empty uses the deployment default. */
  speechModel: z.string(),
  transcribe: z.boolean(),
  /** Self-hosted server base URL and model ids (never the key). Empty for hosted providers. */
  endpoint: z.string().default(""),
  ttsModel: z.string().default(""),
  sttModel: z.string().default(""),
});
export type VoiceCredential = z.infer<typeof VoiceCredentialSchema>;

export const VoiceStatusSchema = z.object({
  configured: z.boolean(),
  ready: z.boolean(),
  transcribe: z.boolean(),
  provider: z.string().nullable(),
  voiceId: z.string(),
});
export type VoiceStatus = z.infer<typeof VoiceStatusSchema>;

export const DeploymentSettingsSchema = z.object({
  ownerUserId: Id.nullable(),
  signupsEnabled: z.boolean(),
  signupAllowlist: z.array(z.string()),
  hasDeploymentModelCredential: z.boolean(),
  defaultProvider: z.string().nullable(),
  defaultModel: z.string().nullable(),
  computerHost: z.enum(["docker", "this-mac"]).nullable(),
  canChooseHostComputer: z.boolean(),
  sandboxProvider: z.string(),
});

/** Public metadata only; adapter validation and constructor options stay server-side. */
export const ComputerProviderFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(["text", "secret", "url", "select"]),
  required: z.boolean(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  validation: z.enum(["public-https"]).optional(),
  /** A saved credential must be re-entered when its destination changes. */
  destination: z.string().optional(),
});
export type ComputerProviderField = z.infer<typeof ComputerProviderFieldSchema>;
export const ComputerProviderDescriptorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  fields: z.array(ComputerProviderFieldSchema),
  capabilities: z.object({ perAccount: z.boolean() }),
});
export type ComputerProviderDescriptor = z.infer<typeof ComputerProviderDescriptorSchema>;
export const ComputerProviderSettingsSchema = z.object({
  provider: z.string(),
  defaultProvider: z.string(),
  providers: z.array(ComputerProviderDescriptorSchema),
  values: z.record(z.string(), z.string()),
  savedSecrets: z.record(z.string(), z.boolean()),
});
export type ComputerProviderSettings = z.infer<typeof ComputerProviderSettingsSchema>;
export const ComputerProviderUpdateSchema = z.object({
  provider: z.string().trim().min(1).max(64),
  values: z.record(z.string().max(64), z.string().trim().max(4096)).default({}),
});
export type ComputerProviderUpdate = z.infer<typeof ComputerProviderUpdateSchema>;

export const ServerUpdateSourceSchema = z.object({
  repoUrl: z.string().max(400),
  branch: z.string().max(200),
  official: z.boolean(),
});
export type ServerUpdateSource = z.infer<typeof ServerUpdateSourceSchema>;

export const ServerUpdateStepSchema = z.object({
  id: z.string().max(40),
  label: z.string().max(200),
  ok: z.boolean(),
  exitCode: z.number().int().nullable(),
  output: z.string().max(8_001),
});

/** How an update reaches new code: published images, a build on the server, or a git checkout. */
export const ServerUpdateStrategySchema = z.enum(["pull", "build", "checkout"]);
export type ServerUpdateStrategy = z.infer<typeof ServerUpdateStrategySchema>;

/** `sidecar` is the Compose deployment; `checkout` is a supervised source install. */
export const ServerUpdateModeSchema = z.enum(["sidecar", "checkout", "unavailable"]);
export type ServerUpdateMode = z.infer<typeof ServerUpdateModeSchema>;

/**
 * What Settings should render for a deployment owner.
 * `sidecar`: Check / Update / Rollback through the updater sidecar.
 * `compose`: Compose install without a reachable sidecar; show host pull/up commands.
 * `source`: git checkout / `pnpm dev`; show terminal commands, never a fake Apply.
 */
export const ServerUpdateInstallKindSchema = z.enum(["sidecar", "compose", "source"]);
export type ServerUpdateInstallKind = z.infer<typeof ServerUpdateInstallKindSchema>;

export const ServerUpdateRunSchema = z.object({
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  ok: z.boolean(),
  fromCommit: z.string().nullable(),
  toCommit: z.string().nullable(),
  fromTag: z.string().nullable(),
  toTag: z.string().nullable(),
  strategy: ServerUpdateStrategySchema.nullable(),
  repoUrl: z.string().max(400),
  branch: z.string().max(200),
  /**
   * `recreated` means the updater sidecar replaced the containers and no restart is owed.
   * `supervised` means the process exited and its supervisor is bringing it back.
   */
  restart: z.enum(["recreated", "supervised", "manual", "not-required"]),
  restartAdvice: z.string(),
  error: z.string().nullable(),
  steps: z.array(ServerUpdateStepSchema),
});
export type ServerUpdateRun = z.infer<typeof ServerUpdateRunSchema>;

export const ServerUpdateStatusSchema = z.object({
  supported: z.boolean(),
  unsupportedReason: z.string().nullable(),
  installKind: ServerUpdateInstallKindSchema,
  /** Host commands to run when `installKind` is not `sidecar`. Empty when the sidecar applies. */
  manualCommands: z.array(z.string()),
  mode: ServerUpdateModeSchema,
  strategy: ServerUpdateStrategySchema.nullable(),
  strategyNote: z.string().nullable(),
  version: z.string(),
  revision: z.string().nullable(),
  commit: z.string().nullable(),
  branch: z.string().nullable(),
  remoteUrl: z.string().nullable(),
  dirty: z.boolean(),
  dirtyPaths: z.array(z.string()),
  image: z.string().nullable(),
  imageTag: z.string().nullable(),
  previousImageTag: z.string().nullable(),
  canRollback: z.boolean(),
  source: ServerUpdateSourceSchema,
  officialRepoUrl: z.string(),
  restartSupervisor: z.enum(["systemd", "pm2", "declared", "none"]),
  restartAdvice: z.string(),
  running: z.boolean(),
  lastRun: ServerUpdateRunSchema.nullable(),
});
export type ServerUpdateStatus = z.infer<typeof ServerUpdateStatusSchema>;

export const ServerUpdateCheckSchema = z.object({
  status: z.enum(["unavailable", "dirty", "up-to-date", "available"]),
  reason: z.string().nullable(),
  changed: z.array(z.string()),
  commit: z.string().nullable(),
  targetCommit: z.string().nullable(),
  targetTag: z.string().nullable(),
  behindBy: z.number().int().nonnegative(),
});
export type ServerUpdateCheck = z.infer<typeof ServerUpdateCheckSchema>;

export const ServerUpdateRequestSchema = z.object({
  repoUrl: z.string().max(400).optional(),
  branch: z.string().max(200).optional(),
});
export type ServerUpdateRequest = z.infer<typeof ServerUpdateRequestSchema>;

export const MeSchema = z.object({
  maxUploadSizeBytes: z.number().int().positive().optional(),
  maxAttachmentsPerMessage: z.number().int().positive().optional(),
  /** Operator-configured menu links. Absent from older servers. */
  navLinks: z.array(NavLinkSchema).default([]),
  startOver: z.boolean().optional(),
  userId: Id,
  email: z.string().email(),
  name: z.string(),
  spaceId: Id,
  /** Deprecated: app accounts never have server administrator privileges. Always false. */
  isDeploymentOwner: z.boolean(),
  /** Listed in LABRADOODLE_ADMIN_EMAILS with a verified email: reviews plugins, adds stdio MCP servers, grants access. */
  isAdmin: z.boolean().default(false),
  needsModel: z.boolean(),
  defaultProvider: z.string().nullable(),
  defaultModel: z.string().nullable(),
  /** Provider the active default runs on with the server's own credentials, without a key. */
  hostCredentialProvider: z.string().nullable(),
  /** Kind of those credentials, e.g. "AWS IAM"; set with hostCredentialProvider. */
  hostCredentialSource: z.string().nullable(),
  computerHost: z.enum(["docker", "this-mac"]).nullable(),
  canChooseHostComputer: z.boolean(),
  sandboxProvider: z.string(),
  /** Whether this account can add stdio MCP servers here. Absent from older servers. */
  mcpStdioEnabled: z.boolean().default(false),
  avatarStyle: AvatarStyleSchema,
  /**
   * The user's IANA timezone, or null when unset (bots then see UTC only).
   * Absent from servers that predate it.
   */
  timezone: z.string().nullable().optional(),
  /**
   * The app language last reported for the user, or null until an app reports it.
   * Absent from servers that predate it.
   */
  locale: z.string().nullable().optional(),
  /** Doodle's replies are read aloud as they arrive. */
  readAloud: z.boolean(),
  /** The wallet bots can spend from, when this deployment offers one. Absent from older servers. */
  paymentWalletProvider: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
});
export type Me = z.infer<typeof MeSchema>;

export const AppBootstrapSchema = z.object({
  me: MeSchema,
  workspaces: z.array(WorkspaceSchema),
  doodle: DoodleSchema,
  chats: z.array(ChatSchema),
  thread: ThreadSnapshotSchema.nullable(),
  /** Set when the requested chat is the caller's but lives in another of their workspaces. */
  threadSpaceId: Id.optional(),
});
export type AppBootstrap = z.infer<typeof AppBootstrapSchema>;
