import type {
  AnyContractProcedure,
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from "@orpc/contract";
import { eventIterator, oc } from "@orpc/contract";
import * as z from "zod";
import { AiConsentQuerySchema, AiConsentStatusSchema } from "./ai-consent.js";
import { AnalyticsScreenInput } from "./analytics.js";
import {
  ARTIFACT_DESCRIPTION_MAX_LENGTH,
  ARTIFACT_NAME_MAX_LENGTH,
  ATTACHMENT_COUNT_CEILING,
} from "./attachments.js";
import { AuditEventListInputSchema, AuditEventPageSchema } from "./audit-events.js";
import {
  BotSecretMetadata,
  LOGIN_FIELD_LIMIT,
  LoginFieldInput,
  StoredBotSecretName,
  VaultPutInput,
  VaultRevealed,
  VaultRevealInput,
} from "./bot-secrets.js";
import {
  ActionApprovalRuleSchema,
  ActionAutoReviewSettingsSchema,
  AgentSkillCatalogEntrySchema,
  AgentSkillSchema,
  AppBootstrapSchema,
  AppLocaleSchema,
  ApprovalModeSchema,
  ArtifactSchema,
  ArtifactVersionSchema,
  ArtifactWithContentSchema,
  AvatarStyleSchema,
  CapabilityInstallSchema,
  ChatAlertSchema,
  ChatMemberSchema,
  ChatNameSchema,
  ChatSchema,
  CONNECTION_LABEL_MAX_LENGTH,
  ComputerProviderSettingsSchema,
  ComputerProviderUpdateSchema,
  ComputerReleaseReasonSchema,
  ComputerStatusSchema,
  ComputerUpdateSchema,
  ConnectionCatalogItemSchema,
  ConnectionSchema,
  CreateAgentSkillInput,
  CreateRoutineInput,
  DeploymentSettingsSchema,
  DoodleSchema,
  IntegrationCatalogResultSchema,
  McpServerConfigInput,
  McpServerSchema,
  MemoryDocumentSchema,
  MemoryPromptBudgetSchema,
  MeSchema,
  ModelApiProtocolSchema,
  ModelBackupChoiceSchema,
  ModelBackupListSchema,
  ModelCatalogEntrySchema,
  ModelConnectInputSchema,
  ModelConnectionLabelSchema,
  ModelConnectionTargetSchema,
  ModelCredentialSchema,
  ModelOAuthBeginSchema,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  PluginMarketplaceCatalogSchema,
  PluginPartSchema,
  PluginPreviewSchema,
  PluginSubmissionReviewSchema,
  PluginSubmissionSchema,
  PluginSubmissionStatusSchema,
  REPLY_QUOTE_MAX_LENGTH,
  RoutineSchema,
  ServerUpdateCheckSchema,
  ServerUpdateRequestSchema,
  ServerUpdateRunSchema,
  ServerUpdateStatusSchema,
  SkillPlaybookSchema,
  SpaceInviteLinkSchema,
  SpaceInvitePreviewSchema,
  SpaceMembersSchema,
  SpaceMemoryConfigSchema,
  TaughtSkillSchema,
  TeachRecordingEventSchema,
  ThreadMessagePageSchema,
  ThreadSnapshotSchema,
  TimeZoneSchema,
  UpdateAgentSkillInput,
  UpdateDoodleInput,
  UsageRecordSchema,
  UsageSummarySchema,
  VoiceCatalogEntrySchema,
  VoiceCredentialSchema,
  VoiceInfoSchema,
  VoiceStatusSchema,
  WorkspaceSchema,
} from "./domain.js";
import { ComputerCommandSchema, ProductEventSchema } from "./events.js";
import { Id, IsoDate, ThinkingLevelSchema } from "./ids.js";
import {
  IntegrationProviderConfigSchema,
  IntegrationSetupStateSchema,
} from "./integration-settings.js";
import { ModelHeadersSchema } from "./model-headers.js";
import { ModelRoleSchema, ModelRoleUpdateSchema, ModelRoleViewSchema } from "./model-roles.js";
import {
  PAGE_LIST_MAX_LIMIT,
  PageDetailSchema,
  PageSummarySchema,
  PageTitleSchema,
  PageVisibilitySchema,
} from "./pages.js";
import {
  PaymentWalletStatusSchema,
  SpendingLimitSchema,
  SpendingStatusSchema,
} from "./payments.js";
import { MessageReactionSchema } from "./reactions.js";
import { RoutineWatchSchema } from "./routine-watch.js";
import {
  ROUTINE_HISTORY_PAGE_SIZE,
  RoutineHistorySchema,
  RoutineRunCursorSchema,
  RunsListOutputSchema,
} from "./runs.js";
import { SearchQueryOutputSchema } from "./search.js";
import { SecurityEventListInputSchema, SecurityEventSchema } from "./security-events.js";

const threadTarget = z.object({ threadId: Id });

export const ChatMentionTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("doodle") }),
  z.object({ kind: z.literal("person"), id: Id }),
  z.object({ kind: z.literal("routine"), id: Id }),
  z.object({ kind: z.literal("connector"), id: Id }),
]);
export type ChatMentionTarget = z.infer<typeof ChatMentionTargetSchema>;

const threadSendFields = threadTarget.safeExtend({
  imageHandling: z.enum(["confirm", "file"]).optional(),
  text: z.string().optional(),
  artifactIds: z.array(Id).max(ATTACHMENT_COUNT_CEILING).optional(),
  /** Mention chips from the composer. */
  mentions: z.array(ChatMentionTargetSchema).max(64).optional(),
  replyToMessageId: Id.optional(),
  replyQuote: z.string().trim().min(1).max(REPLY_QUOTE_MAX_LENGTH).optional(),
  /** Sent from the open page: a reply to its card that quotes nothing. */
  fromPage: z.literal(true).optional(),
  clientNonce: z.string().min(1).max(200).optional(),
});

const threadSendInput = threadSendFields.superRefine((input, ctx) => {
  const text = input.text?.trim() ?? "";
  const artifactIds = input.artifactIds ?? [];
  if (!text && artifactIds.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "Provide text or at least one attachment",
      path: ["text"],
    });
  }
  if (input.replyQuote && !input.replyToMessageId) {
    ctx.addIssue({
      code: "custom",
      message: "replyQuote requires replyToMessageId",
      path: ["replyQuote"],
    });
  }
});

/** `runId` is absent when Doodle does not answer this message. */
const threadSendOutput = z.object({
  seq: z.number().int(),
  taskId: Id.optional(),
  runId: Id.optional(),
});

/** Without text or attachments, only the routines run and no message is saved. */
const threadSendWithRoutinesInput = threadSendFields.safeExtend({
  clientNonce: z.string().min(1).max(200),
  routineIds: z.array(Id).min(1).max(64),
});

const spaceName = z.string().trim().min(1).max(60);

export const appContract = {
  analytics: { screen: oc.input(AnalyticsScreenInput).output(z.object({ ok: z.literal(true) })) },
  aiConsent: {
    status: oc.input(AiConsentQuerySchema).output(AiConsentStatusSchema),
    allow: oc
      .input(
        z.object({
          scope: z.string(),
          version: z.string(),
          keys: z.array(z.string()).min(1).max(200),
        }),
      )
      .output(AiConsentStatusSchema),
    revoke: oc.input(z.object({ key: z.string().nullable() })).output(AiConsentStatusSchema),
  },
  health: oc.output(z.object({ ok: z.literal(true), version: z.string() })),
  me: oc.output(MeSchema),
  preferences: {
    update: oc
      .input(
        z
          .object({
            avatarStyle: AvatarStyleSchema.optional(),
            timezone: TimeZoneSchema.nullable().optional(),
            /** The language the app runs in, so emails can be written in it. */
            locale: AppLocaleSchema.optional(),
            readAloud: z.boolean().optional(),
          })
          .refine(
            (input) =>
              input.avatarStyle !== undefined ||
              input.timezone !== undefined ||
              input.locale !== undefined ||
              input.readAloud !== undefined,
            { message: "Nothing to update" },
          ),
      )
      .output(MeSchema),
    /** Saves a detected timezone only while none is saved, so it never replaces a choice. */
    adoptTimezone: oc.input(z.object({ timezone: TimeZoneSchema })).output(MeSchema),
  },
  spaces: {
    list: oc.output(z.array(WorkspaceSchema)),
    rename: oc
      .input(z.object({ spaceId: Id, name: spaceName }))
      .output(z.object({ id: Id, name: z.string() })),
    members: {
      list: oc.input(z.object({ spaceId: Id })).output(SpaceMembersSchema),
      /** Owner only. The person leaves every chat there; their messages stay. */
      remove: oc
        .input(z.object({ spaceId: Id, userId: Id }))
        .output(z.object({ ok: z.literal(true) })),
      /** Members only; an owner deletes the space instead. */
      leave: oc
        .input(z.object({ spaceId: Id }))
        .output(z.object({ ok: z.literal(true), activeSpaceId: Id })),
    },
    invites: {
      /** Owner only. A new single-use link each call. */
      create: oc.input(z.object({ spaceId: Id })).output(SpaceInviteLinkSchema),
      preview: oc
        .input(z.object({ token: z.string().min(1).max(200) }))
        .output(SpaceInvitePreviewSchema),
      accept: oc
        .input(z.object({ token: z.string().min(1).max(200) }))
        .output(z.object({ spaceId: Id })),
      /** Owner only. Every unused link stops working, for one that went to the wrong place. */
      cancel: oc.input(z.object({ spaceId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  bootstrap: oc.input(z.object({ threadId: Id.optional() })).output(AppBootstrapSchema),
  deployment: {
    get: oc.output(DeploymentSettingsSchema),
    update: oc
      .input(
        z.object({
          signupsEnabled: z.boolean().optional(),
          signupAllowlist: z.array(z.string()).optional(),
          computerHost: z.enum(["docker", "this-mac"]).nullable().optional(),
        }),
      )
      .output(DeploymentSettingsSchema),
  },
  /** Admin choice of where new computers run, with that provider's connection settings. */
  computerProvider: {
    get: oc.output(ComputerProviderSettingsSchema),
    update: oc.input(ComputerProviderUpdateSchema).output(ComputerProviderSettingsSchema),
    /** The signed-in account's provider for Team Computers, over the default. */
    account: {
      get: oc.output(ComputerProviderSettingsSchema),
      update: oc.input(ComputerProviderUpdateSchema).output(ComputerProviderSettingsSchema),
    },
  },
  /** Deployment-owner view of the append-only security event log, newest first. */
  security: {
    events: oc.input(SecurityEventListInputSchema).output(z.array(SecurityEventSchema)),
  },
  /** The organization's audit log, newest first. Organization owners and admins only. */
  audit: {
    events: oc.input(AuditEventListInputSchema).output(AuditEventPageSchema),
  },
  /**
   * Deployment-owner product updates. When the Compose updater sidecar is reachable, these proxy
   * to its `/state` `/plan` `/apply` contract. Rollback stays on the sidecar for ops only and is
   * not exposed here. Never git-fetch from the API process.
   */
  updater: {
    status: oc.output(ServerUpdateStatusSchema),
    check: oc.input(ServerUpdateRequestSchema).output(ServerUpdateCheckSchema),
    apply: oc.input(ServerUpdateRequestSchema).output(ServerUpdateRunSchema),
  },
  models: {
    forRole: oc
      .input(z.object({ role: ModelRoleSchema, expectedUserId: Id.optional() }))
      .output(z.array(ModelCatalogEntrySchema)),
    role: oc
      .input(
        z.object({
          role: ModelRoleSchema,
          expectedUserId: Id.optional(),
        }),
      )
      .output(ModelRoleViewSchema),
    setRole: oc
      .input(
        ModelRoleUpdateSchema.extend({
          role: ModelRoleSchema,
          expectedUserId: Id.optional(),
        }),
      )
      .output(ModelRoleViewSchema),
    list: oc.output(z.array(ModelCatalogEntrySchema)),
    credentials: oc.output(z.array(ModelCredentialSchema)),
    backups: oc.output(z.array(ModelBackupChoiceSchema)),
    setBackups: oc.input(ModelBackupListSchema).output(z.object({ ok: z.literal(true) })),
    connect: oc.input(ModelConnectInputSchema).output(ModelCredentialSchema),
    probeOpenAiCompatible: oc
      .input(
        z.object({
          baseUrl: z.string(),
          credentialId: z.string().optional(),
          headers: ModelHeadersSchema.optional(),
          apiKey: z.string().optional(),
          apiProtocol: ModelApiProtocolSchema.optional(),
        }),
      )
      .output(z.object({ models: z.array(z.string()) })),
    probeCatalog: oc
      .input(
        z.object({
          provider: z.string().trim().min(1),
          apiKey: z.string().trim().min(8),
        }),
      )
      .output(z.object({ models: z.array(z.string()) })),
    beginOAuth: oc
      .input(
        z.object({
          provider: z.string(),
          label: z.string().optional(),
          /** Signs an existing connection in again; null adds another, as connect does. */
          credentialId: ModelConnectionTargetSchema,
          modelId: z.string().optional(),
          thinkingLevel: ThinkingLevelSchema.nullable().optional(),
          makeDefault: z.boolean().optional(),
          /** No loopback listener (web, mobile): the provider shows a code to paste instead. */
          codePage: z.boolean().optional(),
        }),
      )
      .output(ModelOAuthBeginSchema),
    submitOAuthCode: oc
      .input(z.object({ loginId: z.string(), code: z.string().trim().min(1).max(8_192) }))
      .output(z.object({ ok: z.literal(true) })),
    completeOAuth: oc
      .input(z.object({ loginId: z.string() }))
      .output(
        z.discriminatedUnion("status", [
          z.object({ status: z.literal("pending") }),
          z.object({ status: z.literal("ready") }),
          z.object({ status: z.literal("error"), error: z.string() }),
        ]),
      ),
    finishOAuth: oc.input(z.object({ loginId: z.string() })).output(ModelCredentialSchema),
    cancelOAuth: oc
      .input(z.object({ loginId: z.string() }))
      .output(z.object({ ok: z.literal(true) })),
    setDefault: oc
      .input(
        z.object({
          provider: z.string(),
          modelId: z.string(),
          thinkingLevel: ThinkingLevelSchema.nullable().optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    rename: oc
      .input(z.object({ credentialId: Id, label: ModelConnectionLabelSchema }))
      .output(z.object({ ok: z.literal(true) })),
    /** Removes one connection, or every connection of the provider when older apps omit it. */
    disconnect: oc
      .input(z.object({ provider: z.string().trim().min(1), credentialId: Id.optional() }))
      .output(z.object({ ok: z.literal(true) })),
  },
  /** The workspace's Doodle. Only its owner may change it. */
  doodle: {
    get: oc.output(DoodleSchema),
    update: oc.input(UpdateDoodleInput).output(DoodleSchema),
    restoreInstructions: oc
      .input(
        z.object({
          versionId: Id,
          expectedInstructions: z.string(),
          undo: z.boolean().optional(),
        }),
      )
      .output(DoodleSchema),
  },
  /** Chats: only the people in one see it. */
  threads: {
    /** The caller's chats in this workspace, most recent activity first. */
    list: oc.output(z.array(ChatSchema)),
    /** A chat with the caller and these people of the workspace, and Doodle when asked. */
    create: oc
      .input(
        z.object({
          name: ChatNameSchema.optional(),
          userIds: z.array(Id).max(200),
          doodle: z.boolean(),
        }),
      )
      .output(ChatSchema),
    members: oc.input(threadTarget).output(z.array(ChatMemberSchema)),
    /** Only people of the workspace; everyone in the chat may add them. */
    addMembers: oc
      .input(threadTarget.safeExtend({ userIds: z.array(Id).min(1).max(200) }))
      .output(ChatSchema),
    /** Anyone in the chat. Turning Doodle off stops its work here and pauses the chat's routines. */
    setDoodle: oc.input(threadTarget.safeExtend({ doodle: z.boolean() })).output(ChatSchema),
    /** Null clears the name. */
    rename: oc
      .input(threadTarget.safeExtend({ name: ChatNameSchema.nullable() }))
      .output(ChatSchema),
    /** The last person to leave deletes the chat. */
    leave: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    /** Only a chat with no other people in it. */
    delete: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    setMuted: oc
      .input(threadTarget.safeExtend({ muted: z.boolean() }))
      .output(z.object({ ok: z.literal(true) })),
    head: oc.input(threadTarget).output(
      z.object({
        threadId: Id,
        cursor: z.number().int().min(-1),
      }),
    ),
    get: oc.input(threadTarget).output(ThreadSnapshotSchema),
    messages: oc
      .input(
        threadTarget.safeExtend({
          before: z.number().int().nonnegative().optional(),
          around: z
            .object({
              messageId: Id.optional(),
              seq: z.number().int().nonnegative().optional(),
            })
            .optional(),
        }),
      )
      .output(ThreadMessagePageSchema),
    subscribe: oc
      .input(threadTarget.safeExtend({ cursor: z.number().int().min(-1) }))
      .output(eventIterator(ProductEventSchema)),
    send: oc.input(threadSendInput).output(threadSendOutput),
    /**
     * A send that also test-runs the mentioned routines: the message and every run commit
     * together, keyed by the nonce. A separate procedure, because an API without it must
     * reject the call rather than strip the routines and send only the text.
     */
    sendWithRoutines: oc
      .input(threadSendWithRoutinesInput)
      .output(z.object({ routineRunIds: z.array(Id), send: threadSendOutput.optional() })),
    react: oc
      .input(
        threadTarget.safeExtend({
          messageId: Id,
          reaction: MessageReactionSchema,
          clientNonce: z.string().min(1).max(200),
        }),
      )
      .output(z.object({ ok: z.literal(true), runId: Id.optional() })),
    stop: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    clear: oc.input(threadTarget).output(z.object({ ok: z.literal(true) })),
    answer: oc
      .input(
        threadTarget
          .safeExtend({
            runId: Id,
            messageId: Id,
            answer: z.string(),
            /** A login card's answer, one per requested field; `answer` is then empty. */
            fields: z.array(LoginFieldInput).min(1).max(LOGIN_FIELD_LIMIT).optional(),
            /** A login card's answer from apps that predate `fields`; `answer` carries its password. */
            username: z.string().min(1).max(512).optional(),
            /** Only for a login card: use the login for this run only instead of saving it. */
            remember: z.literal(false).optional(),
            /** Turns down a pending secret request; `answer` is then empty. */
            dismiss: z.literal(true).optional(),
          })
          .refine(
            (input) => input.remember === undefined || Boolean(input.fields ?? input.username),
            {
              message: "Only a website login can be used without saving it",
              path: ["remember"],
            },
          )
          .refine(
            (input) =>
              input.dismiss
                ? input.answer === "" && !input.username && !input.fields
                : input.fields
                  ? input.answer === "" && !input.username
                  : input.answer.length > 0,
            "Send either an answer or a dismissal",
          ),
      )
      .output(z.object({ ok: z.literal(true) })),
    /** `unreadAfterSeq`: the seq read up to before this call, null when nothing was unread. */
    markRead: oc
      .input(threadTarget)
      .output(z.object({ ok: z.literal(true), unreadAfterSeq: z.number().int().nullable() })),
    /** With `messageId`, the chat reads as unread from that message: the next open puts New above it. */
    markUnread: oc
      .input(threadTarget.safeExtend({ messageId: Id.optional() }))
      .output(z.object({ ok: z.literal(true) })),
  },
  /** The caller's own computer in this workspace. */
  computer: {
    status: oc.output(ComputerStatusSchema),
    boot: oc.output(ComputerStatusSchema),
    stop: oc.output(ComputerStatusSchema),
    recover: oc.output(ComputerUpdateSchema),
    reset: oc.output(ComputerStatusSchema),
    update: oc.output(ComputerUpdateSchema),
    updates: oc.output(z.array(ComputerUpdateSchema)),
    releaseInterrupted: oc
      .input(z.object({ id: Id, workersStopped: z.literal(true) }))
      .output(z.object({ ok: z.literal(true) })),
    dismissUpdate: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
    dismissDiskWarning: oc.output(z.object({ ok: z.literal(true) })),
    takeover: oc.output(z.object({ leaseId: Id, expiresAt: z.string() })),
    release: oc
      .input(z.object({ reason: ComputerReleaseReasonSchema.optional() }))
      .output(z.object({ ok: z.literal(true) })),
    input: oc
      .input(
        z.object({
          kind: z.enum(["key", "pointer", "clipboard", "scroll"]),
          payload: z.record(z.string(), z.unknown()),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    files: oc
      .input(z.object({ path: z.string().default("/") }))
      .output(
        z.array(z.object({ path: z.string(), kind: z.enum(["file", "dir"]), size: z.number() })),
      ),
    readFile: oc
      .input(z.object({ path: z.string() }))
      .output(z.object({ path: z.string(), content: z.string() })),
    downloadFile: oc
      .input(z.object({ path: z.string().min(1) }))
      .output(z.object({ path: z.string(), contentBase64: z.string() })),
    uploadFile: oc
      .input(z.object({ path: z.string().min(1), contentBase64: z.string() }))
      .output(z.object({ ok: z.literal(true) })),
    terminalUrl: oc.output(z.object({ url: z.string().nullable() })),
    commands: oc.output(z.array(ComputerCommandSchema.extend({ createdAt: z.string() }))),
    screenUrl: oc.output(z.object({ url: z.string().nullable() })),
    heartbeat: oc.output(z.object({ ok: z.literal(true) })),
  },
  memory: {
    /** A chat's memory with `threadId`, else the caller's personal memory in this workspace. */
    list: oc.input(z.object({ threadId: Id.optional() })).output(z.array(MemoryDocumentSchema)),
    budget: oc.input(threadTarget).output(MemoryPromptBudgetSchema),
    update: oc
      .input(
        z.object({
          documentId: Id,
          content: z.string(),
          expectedRevision: z.number().int().positive().optional(),
        }),
      )
      .output(MemoryDocumentSchema),
    remove: oc.input(z.object({ documentId: Id })).output(z.object({ ok: z.literal(true) })),
    exportMarkdown: oc.input(z.object({ threadId: Id.optional() })).output(z.string()),
    providerConfig: oc.output(SpaceMemoryConfigSchema.nullable()),
    connectProvider: oc
      .input(
        z.object({
          provider: z.string().min(1),
          settings: z.record(z.string(), z.string()),
          credentials: z.record(z.string(), z.string()),
        }),
      )
      .output(SpaceMemoryConfigSchema),
    disconnectProvider: oc.output(z.object({ ok: z.literal(true) })),
  },
  routines: {
    list: oc.input(threadTarget).output(z.array(RoutineSchema)),
    history: oc
      .input(
        z.object({
          routineId: Id,
          before: RoutineRunCursorSchema.optional(),
          limit: z.number().int().min(1).max(ROUTINE_HISTORY_PAGE_SIZE).optional(),
        }),
      )
      .output(RoutineHistorySchema),
    create: oc.input(CreateRoutineInput).output(RoutineSchema),
    update: oc
      .input(
        z
          .object({
            routineId: Id,
            name: z.string().optional(),
            prompt: z.string().optional(),
            crons: z.array(z.string().min(1)).optional(),
            timezone: TimeZoneSchema.optional(),
            active: z.boolean().optional(),
            notify: z.boolean().optional(),
            webhookEnabled: z.boolean().optional(),
            githubEnabled: z.boolean().optional(),
            /** Null clears the routine's own model and runs it on Doodle's. */
            modelProvider: z.string().trim().min(1).max(80).nullable().optional(),
            modelId: z.string().trim().min(1).max(200).nullable().optional(),
            thinkingLevel: ThinkingLevelSchema.nullable().optional(),
            /** ISO datetime to arm a never-run one-shot. */
            runAt: IsoDate.optional(),
            /** Null removes the change trigger. */
            watch: RoutineWatchSchema.nullable().optional(),
          })
          .superRefine((value, ctx) => {
            if (
              value.crons &&
              value.crons.length === 0 &&
              value.webhookEnabled === false &&
              value.githubEnabled === false &&
              value.watch === null
            ) {
              ctx.addIssue({
                code: "custom",
                message: "Add a schedule, webhook, GitHub, or change trigger",
                path: ["crons"],
              });
            }
          }),
      )
      .output(RoutineSchema),
    remove: oc.input(z.object({ routineId: Id })).output(z.object({ ok: z.literal(true) })),
    /** A new secret for the routine's webhook; the old one stops working. */
    rotateWebhookSecret: oc
      .input(z.object({ routineId: Id }))
      .output(z.object({ secret: z.string(), path: z.string() })),
    testRun: oc
      .input(
        z.object({
          routineId: Id,
          clientNonce: z.string().min(1).max(200).optional(),
        }),
      )
      .output(z.object({ runId: Id })),
  },
  skills: {
    list: oc.output(z.array(TaughtSkillSchema)),
    get: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    start: oc.input(z.object({ goal: z.string().min(1).max(4000) })).output(TaughtSkillSchema),
    appendEvent: oc
      .input(z.object({ skillId: Id, event: TeachRecordingEventSchema }))
      .output(TaughtSkillSchema),
    snapshot: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    stop: oc.input(z.object({ skillId: Id })).output(TaughtSkillSchema),
    updateDraft: oc
      .input(
        z.object({
          skillId: Id,
          name: z.string().optional(),
          playbook: SkillPlaybookSchema,
        }),
      )
      .output(TaughtSkillSchema),
    save: oc
      .input(z.object({ skillId: Id, name: z.string().optional() }))
      .output(TaughtSkillSchema),
    testRun: oc
      .input(z.object({ skillId: Id, prompt: z.string().optional() }))
      .output(z.object({ runId: Id })),
    remove: oc.input(z.object({ skillId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  /** Claude Agent Skills (SKILL.md recipes) shared across assistants (not taught/demo skills). */
  agentSkills: {
    list: oc.output(z.array(AgentSkillCatalogEntrySchema)),
    get: oc
      .input(
        z
          .object({ skillId: Id.optional(), name: z.string().min(1).max(80).optional() })
          .superRefine((input, ctx) => {
            if (!input.skillId && !input.name?.trim()) {
              ctx.addIssue({
                code: "custom",
                message: "Provide skillId or name",
                path: ["skillId"],
              });
            }
          }),
      )
      .output(AgentSkillSchema),
    create: oc.input(CreateAgentSkillInput).output(AgentSkillSchema),
    update: oc.input(UpdateAgentSkillInput).output(AgentSkillSchema),
    remove: oc.input(z.object({ skillId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  marketplace: {
    catalog: oc
      .input(z.object({ query: z.string().trim().max(200).default("") }))
      .output(PluginMarketplaceCatalogSchema),
    /** Admins only. */
    submissions: oc
      .input(z.object({ status: PluginSubmissionStatusSchema.default("pending") }))
      .output(z.array(PluginSubmissionSchema)),
    /** Admins only. */
    review: oc.input(PluginSubmissionReviewSchema).output(PluginSubmissionSchema),
  },
  capabilities: {
    list: oc.output(z.array(CapabilityInstallSchema)),
    catalogSearch: oc
      .input(
        z.object({
          query: z.string().trim().max(253).default(""),
          usePublicCatalog: z.boolean().default(false),
        }),
      )
      .output(
        z.object({
          enabled: z.boolean(),
          results: z.array(IntegrationCatalogResultSchema),
        }),
      ),
    install: oc
      .input(
        z.object({
          kind: z.enum(["skill", "plugin", "mcp", "api", "graphql"]),
          name: z.string().min(1).max(120),
          source: z.string().min(1).max(2048),
          config: z.record(z.string(), z.unknown()).default({}),
          credential: z.string().max(16_384).optional(),
          /** Required for plugins: confirms the exact previewed package content. */
          pluginDigest: z
            .string()
            .regex(/^sha256:[a-f0-9]{64}$/)
            .optional(),
          /** Plugins only: which parts to add; all supported parts when omitted. */
          pluginParts: z.array(PluginPartSchema).min(1).max(2).optional(),
        }),
      )
      .output(CapabilityInstallSchema),
    /** Add or remove parts of an installed plugin at its pinned version; no parts removes it. */
    pluginParts: oc
      .input(z.object({ id: Id, parts: z.array(PluginPartSchema).max(2) }))
      .output(z.object({ install: CapabilityInstallSchema.nullable() })),
    /** Fetch and parse a plugin repo without installing: shows the skills,
     * MCP endpoints, variables, and skipped parts before confirmation. */
    pluginPreview: oc
      .input(z.object({ source: z.string().min(1).max(2048) }))
      .output(PluginPreviewSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  mcp: {
    servers: {
      list: oc.output(z.array(McpServerSchema)),
      create: oc.input(McpServerConfigInput).output(McpServerSchema),
      update: oc
        .input(
          z.union([
            z.object({ id: Id, config: McpServerConfigInput }),
            z.object({ id: Id, secret: z.string().min(1).max(16384) }),
          ]),
        )
        .output(McpServerSchema),
      remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
      /** Launch the server once (installing a stdio package if needed), list its tools, close it. */
      test: oc.input(z.object({ id: Id })).output(McpServerSchema),
    },
    /** An approval card for a server Doodle added: connecting turns the server on. */
    approvals: {
      approve: oc
        .input(threadTarget.safeExtend({ serverId: Id }))
        .output(z.object({ ok: z.literal(true) })),
      dismiss: oc
        .input(threadTarget.safeExtend({ serverId: Id }))
        .output(z.object({ ok: z.literal(true) })),
    },
    oauth: {
      begin: oc.input(z.object({ serverId: Id, redirectUri: z.string().url().optional() })).output(
        z.discriminatedUnion("status", [
          z.object({
            status: z.literal("authorization_required"),
            sessionId: Id,
            authorizationUrl: z.string().url(),
          }),
          z.object({
            status: z.enum(["already_connected", "authorization_not_requested"]),
          }),
        ]),
      ),
      complete: oc
        .input(z.object({ sessionId: Id, code: z.string().min(1), state: z.string().min(1) }))
        .output(z.object({ ok: z.literal(true) })),
      disconnect: oc.input(z.object({ serverId: Id })).output(z.object({ ok: z.literal(true) })),
    },
  },
  onboarding: {
    /** Flip an app_connect card to connected after authorization completes. */
    appConnected: oc
      .input(
        z.object({
          threadId: Id,
          /** The card's own message, so it is found however far back it is. */
          messageId: Id.optional(),
          provider: z.string(),
          connectorId: z.string().default("composio"),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
  },
  integrationSetup: {
    get: oc.output(IntegrationSetupStateSchema),
    save: oc.input(IntegrationProviderConfigSchema).output(z.object({ ok: z.literal(true) })),
  },
  connections: {
    catalog: oc
      .input(z.object({ query: z.string().optional(), connectorId: z.string().optional() }))
      .output(z.array(ConnectionCatalogItemSchema)),
    list: oc.output(z.array(ConnectionSchema)),
    begin: oc
      .input(
        z.object({
          connectorId: z.string().default("composio"),
          provider: z.string(),
          displayName: z.string(),
        }),
      )
      .output(z.object({ connectionId: Id, authorizationUrl: z.string().nullable() })),
    complete: oc
      .input(z.object({ connectionId: Id, code: z.string().optional() }))
      .output(ConnectionSchema),
    rename: oc
      .input(
        z.object({
          connectionId: Id,
          displayName: z.string().trim().min(1).max(CONNECTION_LABEL_MAX_LENGTH),
        }),
      )
      .output(ConnectionSchema),
    revoke: oc.input(z.object({ connectionId: Id })).output(z.object({ ok: z.literal(true) })),
    /** Tools the connected provider exposes. Read-only; no per-tool allowlist yet. */
    tools: oc.input(z.object({ connectorId: z.string(), provider: z.string() })).output(
      z.array(
        z.object({
          name: z.string(),
          description: z.string(),
        }),
      ),
    ),
  },
  approvalRules: {
    list: oc.output(z.array(ActionApprovalRuleSchema)),
    set: oc
      .input(
        z.object({
          effect: z.enum(["always_allow", "require_approval", "deny"]),
          matchKind: z.enum(["tool", "connector", "site"]),
          matchValue: z.string().trim().min(1),
        }),
      )
      .output(ActionApprovalRuleSchema),
    remove: oc.input(z.object({ id: Id })).output(z.object({ ok: z.literal(true) })),
  },
  /**
   * Sites the signed-in user opens from chat links without the external-link prompt, in every
   * space. The server computes each site from a link; bot fetches never read this list.
   */
  trustedLinkSites: {
    list: oc.output(z.array(z.string())),
    trust: oc
      .input(z.object({ url: z.string().min(1).max(8192) }))
      .output(z.object({ site: z.string() })),
    remove: oc
      .input(z.object({ site: z.string().min(1).max(253) }))
      .output(z.object({ ok: z.literal(true) })),
  },
  autoReview: {
    get: oc.output(ActionAutoReviewSettingsSchema),
    set: oc
      .input(
        z.object({
          mode: ApprovalModeSchema.optional(),
          enabled: z.boolean().optional(),
          skipApprovals: z.boolean().optional(),
        }),
      )
      .output(ActionAutoReviewSettingsSchema),
  },
  artifacts: {
    list: oc.input(threadTarget).output(z.array(ArtifactSchema)),
    /** Files of every chat the caller is in, or of one. */
    listSpace: oc
      .input(
        z.object({
          threadId: Id.optional(),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(60).optional(),
        }),
      )
      .output(
        z.object({
          items: z.array(ArtifactSchema.extend({ versionCount: z.number().int() })),
          nextCursor: z.string().nullable(),
        }),
      ),
    listVersions: oc.input(z.object({ familyId: Id })).output(z.array(ArtifactVersionSchema)),
    create: oc
      .input(
        threadTarget.safeExtend({
          name: z.string().min(1).max(ARTIFACT_NAME_MAX_LENGTH),
          description: z.string().max(ARTIFACT_DESCRIPTION_MAX_LENGTH).optional(),
          mimeType: z.string().min(1),
          contentBase64: z.string().min(1),
          /** Unique per upload; a retry with the same nonce returns the artifact it created. */
          clientNonce: z.string().min(1).max(200).optional(),
        }),
      )
      .output(ArtifactSchema),
    get: oc.input(threadTarget.safeExtend({ artifactId: Id })).output(ArtifactWithContentSchema),
    getById: oc.input(z.object({ artifactId: Id })).output(ArtifactWithContentSchema),
    remove: oc.input(z.object({ artifactId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  /** Pages Doodle built in the caller's chats in this workspace. */
  pages: {
    /** Pinned first, then most recently updated. */
    list: oc
      .input(
        z.strictObject({
          threadId: Id.optional(),
          cursor: z.string().max(500).optional(),
          limit: z.number().int().min(1).max(PAGE_LIST_MAX_LIMIT).optional(),
          /** Titles containing this text, for the command palette. */
          query: z.string().trim().min(1).max(200).optional(),
        }),
      )
      .output(
        z.strictObject({ items: z.array(PageSummarySchema), nextCursor: z.string().nullable() }),
      ),
    /** `link` also reads the page's share link, which only the share controls need. */
    get: oc
      .input(
        z.strictObject({
          pageId: Id,
          version: z.number().int().positive().optional(),
          link: z.boolean().optional(),
        }),
      )
      .output(PageDetailSchema),
    rename: oc
      .input(z.strictObject({ pageId: Id, title: PageTitleSchema }))
      .output(PageSummarySchema),
    /**
     * Turning the link on returns the page's live link, or a new one when it has none it can
     * read; turning it off breaks the old link, so the next turn-on issues a new one.
     */
    setVisibility: oc
      .input(z.strictObject({ pageId: Id, visibility: PageVisibilitySchema }))
      .output(
        z.strictObject({ visibility: PageVisibilitySchema, shareUrl: z.string().nullable() }),
      ),
    pin: oc.input(z.strictObject({ pageId: Id, pinned: z.boolean() })).output(PageSummarySchema),
    remove: oc.input(z.strictObject({ pageId: Id })).output(z.object({ ok: z.literal(true) })),
  },
  usage: {
    list: oc.output(z.array(UsageRecordSchema)),
    summary: oc.output(UsageSummarySchema),
  },
  export: {
    /**
     * A one-time token for `GET /api/account/export?token=`, which streams the account zip. Needs
     * a recent identity confirmation on this session (IDENTITY_CONFIRMATION_REQUIRED).
     */
    accountToken: oc.output(z.object({ token: z.string() })),
  },
  notifications: {
    /**
     * Alerts for the signed-in user's chats in this workspace, live while connected. `doodle`
     * means the workspace's Doodle settings changed: read `doodle.get` again.
     */
    subscribe: oc.output(
      eventIterator(
        z.object({
          type: z.enum(["alert", "heartbeat", "doodle"]),
          alert: ChatAlertSchema.optional(),
        }),
      ),
    ),
    registerPush: oc
      // No whitespace: the token store keeps the registering session on the next line.
      .input(
        z.object({
          token: z.string().min(8).max(512).regex(/^\S+$/),
          presentation: z.literal("android_sender").optional(),
        }),
      )
      .output(z.object({ ok: z.literal(true) })),
    unregisterPush: oc.output(z.object({ ok: z.literal(true) })),
  },
  search: {
    query: oc.input(z.object({ q: z.string().max(200) })).output(SearchQueryOutputSchema),
  },
  links: {
    /**
     * The site icon for a link's origin as a small data URL, resolved and cached by the server.
     * `retry` means the server was too busy to look; the origin may still have an icon.
     */
    favicon: oc
      // The longest origin: a scheme, a 253-character host name and a port.
      .input(z.object({ origin: z.string().max("https://".length + 253 + ":65535".length) }))
      .output(z.object({ icon: z.string().nullable(), retry: z.boolean().optional() })),
  },
  runs: {
    list: oc.input(z.object({ filter: z.enum(["active", "recent"]) })).output(RunsListOutputSchema),
  },
  /** The account's spending limit for payments its bots make. */
  spendingLimit: {
    get: oc.output(SpendingStatusSchema),
    /** `null` removes the limit. */
    set: oc
      .input(z.object({ limit: SpendingLimitSchema.nullable() }).strict())
      .output(SpendingStatusSchema),
  },
  /** The signed-in user's wallet; absent when the deployment offers none. */
  paymentWallet: {
    status: oc.output(PaymentWalletStatusSchema),
    /** Starts a sign-in the user finishes with the provider; `status` then reports it. */
    connect: oc.output(PaymentWalletStatusSchema),
    disconnect: oc.output(PaymentWalletStatusSchema),
  },
  voice: {
    catalog: oc.output(z.array(VoiceCatalogEntrySchema)),
    status: oc.output(VoiceStatusSchema),
    credentials: oc.output(z.array(VoiceCredentialSchema)),
    connect: oc
      .input(
        z
          .object({
            provider: z.string(),
            /** Optional for a self-hosted server and for providers without keys. */
            apiKey: z.string().max(4096).default(""),
            voiceId: z.string().max(120).optional(),
            speechModel: z.string().max(64).optional(),
            /** Self-hosted (OpenAI-compatible) server address and model ids. */
            baseUrl: z.string().max(2048).optional(),
            ttsModel: z.string().max(200).optional(),
            sttModel: z.string().max(200).optional(),
          })
          .superRefine((input, ctx) => {
            // Hosted keys are checked by the server, which knows which providers are keyless.
            if (input.provider === OPENAI_COMPATIBLE_PROVIDER_ID && !input.baseUrl?.trim()) {
              ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "Enter a server URL." });
            }
          }),
      )
      .output(VoiceCredentialSchema),
    disconnect: oc
      .input(z.object({ provider: z.string().min(1) }))
      .output(z.object({ ok: z.literal(true) })),
    setVoice: oc
      .input(
        z.object({
          voiceId: z.string().min(1).max(120),
          provider: z.string().optional(),
        }),
      )
      .output(VoiceStatusSchema),
    setSpeechModel: oc
      .input(
        z.object({
          provider: z.string().min(1),
          speechModel: z.string().max(64),
        }),
      )
      .output(VoiceCredentialSchema),
    voices: oc
      .input(z.object({ provider: z.string().optional() }))
      .output(z.array(VoiceInfoSchema)),
    prepare: oc
      .input(
        z.object({
          text: z.string().max(20000),
          voiceId: z.string().max(120).optional(),
        }),
      )
      .output(z.object({ ready: z.boolean(), utterances: z.array(z.string()) })),
  },
  vault: {
    list: oc.output(z.array(BotSecretMetadata)),
    put: oc.input(VaultPutInput).output(BotSecretMetadata),
    /** Needs a recent identity confirmation on this session (IDENTITY_CONFIRMATION_REQUIRED). */
    reveal: oc.input(VaultRevealInput).output(VaultRevealed),
    remove: oc
      .input(z.object({ name: StoredBotSecretName }))
      .output(z.object({ ok: z.literal(true) })),
  },
};

export type AppContract = typeof appContract;

type ProcedurePaths<Router, Prefix extends string = ""> = {
  [Key in keyof Router & string]: Router[Key] extends AnyContractProcedure
    ? `${Prefix}${Key}`
    : ProcedurePaths<Router[Key], `${Prefix}${Key}/`>;
}[keyof Router & string];

type AtPath<Tree, Path extends string> = Path extends `${infer Head}/${infer Rest}`
  ? Head extends keyof Tree
    ? AtPath<Tree[Head], Rest>
    : never
  : Path extends keyof Tree
    ? Tree[Path]
    : never;

/** A procedure's URL path under `/rpc/`, such as `threads/list`. */
export type RpcPath = ProcedurePaths<AppContract>;
type RpcInputs = { [Path in RpcPath]: AtPath<InferContractRouterInputs<AppContract>, Path> };
type RpcOutputs = { [Path in RpcPath]: AtPath<InferContractRouterOutputs<AppContract>, Path> };
export type RpcInput<Path extends RpcPath> = RpcInputs[Path];
export type RpcOutput<Path extends RpcPath> = RpcOutputs[Path];
