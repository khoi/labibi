import type {
  AgentRunRequest,
  ComputerRef,
  MemoryScope,
  SemanticMemoryProvider,
} from "@labradoodle/adapter-kit";
import {
  DEFAULT_CONTEXT_STRATEGY,
  isModelCredentialRejected,
  runContinueJob,
  SandboxUnavailableError,
  SandboxUnresponsiveError,
} from "@labradoodle/adapter-kit";
import type { MessageBlock, ModelRoleChoice, RunStatus } from "@labradoodle/contracts";
import { disabledBuiltinToolSet } from "@labradoodle/contracts";
import {
  assertTransition,
  expandSkillReferencesInPrompt,
  formatSkillRunPrompt,
  formatSkillsCatalogInstruction,
  isPersonStartedRun,
  isTerminal,
  MISSING_MODEL_RUN_ERROR,
  nextFence,
  promptInvokesSkill,
  redactSecrets,
  userRunError,
  userTurnMessageForRun,
} from "@labradoodle/core";
import type { ThreadEvents } from "@labradoodle/db";
import {
  accountDeactivated,
  appendEventInTransaction,
  cancelDeactivatedAccountRuns,
  cancelRunsInTransaction,
  computerHomeKey,
  createPendingSteeringRun,
  isPartialReplyClientNonce,
  isTooManyDatabaseConnections,
  loadRunHistoryMessages,
  loadRunTurnCheckpoint,
  RunHistoryWriteError,
  readRunTimingFields,
  recordUsage,
  settleReleasedTakeoverCards,
} from "@labradoodle/db";
import { enrichLogContext, getLogger } from "@labradoodle/logging";
import { sanitizedError } from "@labradoodle/logging/monitoring";
import { formatAgentEnvironmentInstruction } from "./agent-environment.js";
import { createApprovedEffectReplayQueue } from "./approval-effect.js";
import { PARTIAL_REPLY_NOTE } from "./automated-messages.js";
import {
  commandCredentialRedactions,
  loadBotCommandEnvironment,
  loadLoginPasswordRedactions,
  loadRunCodeRedactions,
  loadRunLoginRedactions,
} from "./bot-secrets.js";
import { createBrowserProvider } from "./browser-provider-factory.js";
import { partitionTools } from "./builtin-tool-bridge.js";
import { builtinAgentTools } from "./builtin-tools.js";
import { cloudAgentsEnabled } from "./cloud-agent-factory.js";
import { mergeConnectedPlugins, needsLivePluginSync } from "./composio-connector.js";
import { diskNoteInstruction, recordComputerDisk } from "./computer-disk.js";
import { scheduleComputerSleep } from "./computer-idle.js";
import type { ComputerExecutionLease } from "./computer-lifecycle.js";
import {
  ComputerBusyError,
  provisionComputer,
  releaseComputerExecutionLease,
  renewComputerExecutionLease,
  screenLeaseIdForRun,
  waitForComputerExecutionLease,
} from "./computer-lifecycle.js";
import {
  computerCheckpointResolver,
  isLostPinnedModel,
  PINNED_COMPUTER_MODEL_LOST_RUN_ERROR,
  resolveComputerRunModel,
} from "./computer-model-settings.js";
import { checkpointAndRecordComputerWorkspace } from "./computer-workspace.js";
import {
  connectedContext,
  loadLivePluginSlugs,
  persistLivePluginConnections,
  selectRunConnections,
} from "./connection-context.js";
import { formatCurrentTimeInstruction } from "./current-time.js";
import { resolveDeploymentModel } from "./deployment-model.js";
import type { ExecutorDeps } from "./executor-deps.js";
import {
  formatCompactedSummary,
  formatRecalledMemory,
  historyWindowSize,
  LEGACY_HISTORY_WINDOW_SIZE,
  MAX_RECALLED_MEMORIES,
  selectCompactedHistory,
} from "./history-compaction.js";
import {
  chatSpeakers,
  historySpeaker,
  loadChatPeople,
  neutralizeSpeakerLabels,
  personSpeaker,
} from "./history-speakers.js";
import { createMediaGenerationProvider } from "./media-generation-factory.js";
import { loadAgentMemoryContext } from "./memory-context.js";
import {
  effectiveModelRole,
  resolveMemberMainModel,
  selectConfiguredModel,
} from "./model-roles.js";
import type { ModelCredential } from "./model-selection.js";
import {
  findConnectedModelCredential,
  PINNED_PROVIDER_NOT_CONNECTED,
  pinnedModelCredentialError,
  runModelChoice,
} from "./model-selection.js";
import { modelAcceptsImageInput } from "./model-vision.js";
import { usesNativeShell } from "./native-shell.js";
import { paymentWalletConnected } from "./payment-wallets.js";
import { ensurePersonComputer, findPersonComputer, newComputerKind } from "./person-computer.js";
import { isRetiredModelCredentialError } from "./pi-oauth.js";
import { restoreComputerModels } from "./pi-runtime-computer-mode.js";
import { loadPurchaseRedactions } from "./purchase-service.js";
import { loadReplyContext, messageToAgentHistoryText } from "./reply-context.js";
import { backOffRoutineAfterAccountError } from "./routine-backoff.js";
import { lateRoutineRunDueAt, lateRoutineRunInstruction } from "./routine-lateness.js";
import { lazyRunComputer } from "./run-computer.js";
import type {
  RunComputerUseState,
  RunContext,
  RunLeaseState,
  RunningHelper,
  RunState,
} from "./run-context.js";
import { restoreTurnCheckpointEffects, settleRunningHelpers } from "./run-context.js";
import { APPROVED_EFFECT_REPLAY_ORDER, buildApprovalContinuation } from "./run-effects.js";
import {
  dockerComputerToolInstruction,
  persistentComputerInstruction,
  runIdentityInstruction,
  threadContextForRun,
  userTurnInstructions,
} from "./run-instructions.js";
import {
  computerRetryDelay,
  createRunWorkspaceCheckpoint,
  failRunBeforeTurn,
  mayOpenModelStream,
  providerOutageRetryDelay,
  RUN_SETUP_FAILURE_LIMIT,
  renewRunLease,
  requeueComputerRun,
  requeueRunAfterShutdown,
  setupFailureStreak,
  writeComputerRunRequeue,
} from "./run-lifecycle.js";
import { withRunLease } from "./run-messages.js";
import {
  isTerminalModelSetupError,
  resolveConnectedModelKey,
  resolveConnectedRunModel,
  resolvedModelRunFields,
  resolveModelKey,
  resolveRunModel,
  runtimeFallbackModel,
} from "./run-model.js";
import { createReplyState } from "./run-progress.js";
import { runAllowsSilentEmpty, runReplyGuidance } from "./run-replies.js";
import {
  notifyRoutineRetryAttemptsExhausted,
  retryRoutineRun,
  wakeRoutine,
} from "./run-routines.js";
import { BUILTIN_AGENT_TOOL_NAMES, selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { applyTool } from "./run-tools.js";
import { historyMyChatsAllowed } from "./run-tools-memory.js";
import type { UserComputerState } from "./run-tools-user-computer.js";
import { USER_COMPUTER_SHELL_TOOL, userComputerOwner } from "./run-tools-user-computer.js";
import { createRunTrustLoaders } from "./run-trust.js";
import { completeRun, consumeRunEvents, failRun } from "./run-turn.js";
import {
  claimRunSteering,
  loadCurrentTurnImages,
  missingTurnImagesInstruction,
  RECENT_TURN_IMAGE_TURNS,
  withRecentTurnImages,
} from "./run-turn-images.js";
import { inferScript } from "./scripted-runtime.js";
import { loadSharedChatNote } from "./shared-chat-note.js";
import { listAgentSkillRecords } from "./skill-tools.js";
import {
  continueRunClaimFence,
  refreshTakeoverContinuePlan,
  takeoverCheckpointOf,
  takeoverContinuePlan,
} from "./takeover-resume.js";
import { TASK_CATALOG_GUIDANCE } from "./task-catalog.js";
import { parsePlaybook } from "./teaching-session.js";
import {
  createEarlierFileQueue,
  currentTurnFilesInstruction,
  listCurrentTurnFiles,
  listRecentThreadFiles,
  materializeCurrentTurnFiles,
  materializeEarlierFiles,
  materializeRecentThreadFiles,
  recentThreadFilesInstruction,
} from "./thread-artifacts.js";
import { appendToolCompletionAudit } from "./tool-completion-audit.js";
import { toolResultFingerprint } from "./tool-loop.js";
import { restoreTurnCheckpoint } from "./turn-checkpoint.js";
import { createWebProvider } from "./web-provider-factory.js";

/** Same reach as the MCP connector: the person's enabled servers. */
async function verbatimMcpServersForRun(
  prisma: ExecutorDeps["prisma"],
  scope: { botId: string; spaceId: string; userId: string },
) {
  if (!prisma.mcpServer?.findMany) return undefined;
  const servers = await prisma.mcpServer.findMany({
    where: {
      verbatimResults: true,
      enabled: true,
      userId: scope.userId,
    },
    select: { id: true, slug: true },
  });
  if (!servers?.length) return undefined;
  return { ids: servers.map((server) => server.id), slugs: servers.map((server) => server.slug) };
}

export function createRunExecutor(executorDeps: ExecutorDeps) {
  const contextStrategy = executorDeps.contextStrategy ?? DEFAULT_CONTEXT_STRATEGY;
  const web = executorDeps.web ?? createWebProvider();
  const mediaGeneration = executorDeps.mediaGeneration ?? createMediaGenerationProvider();
  const browser =
    executorDeps.browser ?? createBrowserProvider(undefined, { sandbox: executorDeps.sandbox });
  const cloudAgent = executorDeps.cloudAgent;
  const resolveConnectedModel = resolveConnectedRunModel.bind(undefined, executorDeps);

  // Run-scoped connector state (installed MCP sessions) outlives one attempt
  // but not its run, so the session side owns the lifetime: the connector ends
  // it when this worker observes the run's end, and bounds the rest itself.
  const endRunConnectorState = (runId: string) => executorDeps.connector?.endRun?.(runId);
  // Every terminal outcome funnels through finalizeRun — completion, failure,
  // the tool-loop stop and pre-turn failures — but only the attempt that still
  // owns the run finalizes it. A fenced-out attempt must not end the run's
  // state while a newer attempt of this run still needs it; whether it may end
  // it depends on the run row, not on this attempt. A rejected finalizeRun left
  // the run unfinished, so its state survives the retry.
  const events: ThreadEvents = {
    ...executorDeps.events,
    finalizeRun: async (input) => {
      const result = await executorDeps.events.finalizeRun(input);
      if (result || (await runEndedForThisWorker(executorDeps.prisma, input))) {
        endRunConnectorState(input.runId);
      }
      return result;
    },
  };
  const baseDeps: ExecutorDeps = { ...executorDeps, events };
  return {
    resolveConnectedModel,
    contextStrategy,
    resolveModel: resolveRunModel.bind(undefined, baseDeps),
    wakeRoutine: wakeRoutine.bind(undefined, baseDeps),
    notifyRoutineRetryAttemptsExhausted: notifyRoutineRetryAttemptsExhausted.bind(
      undefined,
      baseDeps,
    ),
    retryRoutineRun: retryRoutineRun.bind(undefined, baseDeps),

    async continueRun(runId: string, workerId: string, onRunStarted?: () => void) {
      let deps = baseDeps;
      // A stopping process must not claim work it cannot finish. The row stays
      // queued or expired for a worker that is still running.
      if (deps.shutdownSignal?.aborted) return;
      const run = await deps.prisma.run.findUnique({ where: { id: runId } });
      if (!run) return;
      // Logs and security events raised by this run's tools name its account and space.
      enrichLogContext({
        "run.id": runId,
        "bot.id": run.botId,
        "thread.id": run.threadId,
        "space.id": run.spaceId,
        ...(run.userId ? { "user.id": run.userId } : {}),
      });
      if (isTerminal(run.status as RunStatus)) {
        // Finalized elsewhere (cancelled while waiting, another worker): this
        // worker's run-scoped state for it may end now; until a next touch, the
        // connector's own idle bound holds it.
        endRunConnectorState(runId);
        return;
      }
      // Every way work reaches a bot ends here, so a deactivated account's run stops before it starts.
      if (await accountDeactivated(deps.prisma, run.userId)) {
        // Nothing cancelled: the owner is back (or the run already ended), so carry on.
        if (await cancelDeactivatedAccountRuns(deps.prisma, deps.events, run.userId, runId)) return;
      }
      if (await cancelRunOfFormerMember(deps, run)) return;
      let { resumeCheckpoint, heldForTakeover, takeoverResume } = takeoverContinuePlan(run);

      const fence = nextFence(run.leaseFence);
      const now = new Date();
      const leased = await deps.prisma.run.updateMany({
        where: {
          id: runId,
          ...continueRunClaimFence(run),
          AND: [{ OR: [{ wakeAt: null }, { wakeAt: { lte: now } }] }],
          OR: [
            { status: { in: ["queued", "waiting_input", "waiting_takeover"] } },
            {
              status: { in: ["leased", "running"] },
              leaseExpiresAt: { lte: now },
            },
          ],
        },
        data: {
          status: "leased",
          leaseOwner: workerId,
          leaseFence: fence,
          leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
          error: null,
          checkpoint: null,
          wakeAt: null,
        },
      });
      if (leased.count !== 1) return;

      const current = await deps.prisma.run.findUniqueOrThrow({
        where: { id: runId },
      });
      if (
        current.status === "queued" ||
        current.status === "leased" ||
        current.status === "waiting_input" ||
        current.status === "waiting_takeover"
      ) {
        assertTransition(current.status as RunStatus, "running");
      }
      const started = await deps.prisma.run.updateMany({
        where: {
          id: runId,
          status: "leased",
          leaseOwner: workerId,
          leaseFence: fence,
        },
        data: { status: "running" },
      });
      if (started.count !== 1) return;
      if (takeoverResume) {
        try {
          await settleReleasedTakeoverCards(
            deps.prisma,
            {
              spaceId: run.spaceId,
              threadId: run.threadId,
              botId: run.botId,
              runId,
              reason: takeoverResume.checkpoint,
              lease: { owner: workerId, fence },
            },
            (threadId, seq) => deps.events.notify(threadId, seq),
          );
        } catch (error) {
          // A newer claim owns the run and its takeover cards.
          if (error instanceof RunHistoryWriteError) return;
          throw error;
        }
      }
      // Taken at the run's first real use of its person's computer; chat-only runs never wait.
      let computerLease: ComputerExecutionLease | null = null;
      // Resumed attempts keep the first start, so lateness reflects when the run began.
      const executionStartedAt = current.startedAt ?? new Date();
      // Classified with the first start, so a retry, resume or later schedule edit keeps it.
      let firstLateSince: Date | undefined;
      if (!current.startedAt && run.trigger === "routine" && run.routineId && run.clientNonce) {
        try {
          const routine = await deps.prisma.routine.findUnique({
            where: { id: run.routineId },
            select: { crons: true, timezone: true },
          });
          if (routine) firstLateSince = lateRoutineRunDueAt(run, routine, executionStartedAt);
        } catch {
          // Lateness is optional context; a lookup failure must not prevent a run.
        }
      }
      const executionStarted = await deps.prisma.run.updateMany({
        where: { id: runId, status: "running", leaseOwner: workerId, leaseFence: fence },
        data: { startedAt: executionStartedAt, lateSince: firstLateSince },
      });
      if (executionStarted.count !== 1) return;
      getLogger().info("run.execution_started", {
        ...(await readRunTimingFields(deps.prisma, runId)),
      });
      const attempt = await deps.prisma.attempt.create({
        data: { runId, fence, status: "running" },
      });

      // A newer claim of this run now rejects this attempt's history writes.
      deps = withRunLease(deps, runId, { owner: workerId, fence });
      const lease: RunLeaseState = {
        valid: true,
        completed: false,
        lastCheckAt: 0,
        retainComputer: false,
      };
      const computerUse: RunComputerUseState = {
        reason: "none",
        tool: undefined,
        screenRelease: undefined,
      };
      let runAbortController: AbortController | null = null;
      const runningHelpers = new Map<string, RunningHelper>();
      const settleHelpers = () => settleRunningHelpers(deps, run, runningHelpers);

      let detachShutdown: (() => void) | undefined;
      const heartbeat = setInterval(() => {
        if (lease.completed) return;
        void Promise.all([
          renewRunLease(deps, runId, workerId, fence),
          renewComputerExecutionLease(deps.prisma, computerLease),
        ])
          .then(([runRenewed, computerRenewed]) => {
            if (lease.completed) return;
            if (!runRenewed || !computerRenewed) {
              lease.valid = false;
              runAbortController?.abort();
            }
          })
          .catch(() => {
            if (lease.completed) return;
            lease.valid = false;
            runAbortController?.abort();
          });
      }, 60_000);
      heartbeat.unref?.();
      const stopHeartbeatAfterCompletion = () => {
        lease.completed = true;
        clearInterval(heartbeat);
      };

      const runSecrets = [...deps.secrets];
      let dispatchHandedOff = false;
      try {
        // Durable run ownership and its heartbeat now carry recovery. Model,
        // integration and computer setup must not occupy a queue dispatch slot.
        onRunStarted?.();
        dispatchHandedOff = Boolean(onRunStarted);
        // A saved computer turn owns both identities. Resolve them before consulting
        // today's main selection, whose connection may have changed while paused.
        let turnCheckpoint: string | undefined;
        let checkpointLoadError: Error | undefined;
        try {
          turnCheckpoint = await loadRunTurnCheckpoint(deps.prisma, run);
        } catch (error) {
          checkpointLoadError =
            error instanceof Error ? error : new Error("Unsupported turn checkpoint");
        }
        const storedTurnCheckpoint = Boolean(turnCheckpoint);
        const resolveCheckpointModel = (
          provider: string,
          id: string,
          connectionId?: string,
          effort?: string,
        ) =>
          resolveConnectedModel(
            run,
            provider,
            id,
            (values) => runSecrets.push(...values),
            true,
            effort ?? null,
            connectionId,
          );
        const checkpointIdentity = { provider: run.modelProvider ?? "", id: run.modelId ?? "" };
        const checkpointModelResolver = computerCheckpointResolver(
          turnCheckpoint,
          checkpointIdentity,
          resolveCheckpointModel,
        );
        const savedComputerMode = checkpointModelResolver
          ? restoreTurnCheckpoint(turnCheckpoint!, checkpointIdentity).computerMode
          : undefined;
        let pinnedComputerModels: Awaited<ReturnType<typeof restoreComputerModels>> | undefined;
        let pinnedComputerFailure: string | undefined;
        if (savedComputerMode) {
          try {
            pinnedComputerModels = await restoreComputerModels(
              { resolveFallbackModel: checkpointModelResolver },
              savedComputerMode,
            );
          } catch (error) {
            // A paused turn whose model or account is gone cannot resume; retrying will not help.
            if (!isLostPinnedModel(error)) throw error;
            pinnedComputerFailure = PINNED_COMPUTER_MODEL_LOST_RUN_ERROR;
          }
        }
        const [
          bot,
          thread,
          messages,
          task,
          storedConnections,
          main,
          settings,
          configuredMemory,
          savedSkills,
          agentSkills,
          initialBotCommandEnvironment,
          savedLoginPasswordRedactions,
          purchaseRedactions,
          runLoginRedactions,
          runCodeRedactions,
        ] = await Promise.all([
          deps.prisma.bot.findUniqueOrThrow({ where: { id: run.botId } }),
          deps.prisma.thread.findUniqueOrThrow({
            where: { id: run.threadId },
            include: { _count: { select: { members: true } } },
          }),
          loadRunHistoryMessages(deps.prisma, run, LEGACY_HISTORY_WINDOW_SIZE),
          deps.prisma.task.findUniqueOrThrow({ where: { id: run.taskId } }),
          deps.prisma.connection.findMany({
            where: { userId: run.userId, spaceId: run.spaceId },
            select: {
              id: true,
              connectorId: true,
              provider: true,
              providerRef: true,
              displayName: true,
              status: true,
            },
          }),
          pinnedComputerModels ? Promise.resolve(null) : resolveMemberMainModel(deps, run),
          deps.prisma.deploymentSettings.findUnique({
            where: { id: "default" },
          }),
          deps.memoryProviders.resolve(run.spaceId),
          deps.prisma.taughtSkill.findMany({
            where: { userId: run.userId, status: "saved" },
          }),
          listAgentSkillRecords(deps.prisma, {
            spaceId: run.spaceId,
            userId: run.userId,
          }),
          loadBotCommandEnvironment(deps.prisma, deps.secretStore, run),
          loadLoginPasswordRedactions(deps.prisma, deps.secretStore, run),
          deps.paymentWallet ? loadPurchaseRedactions(deps, run) : [],
          loadRunLoginRedactions(deps.prisma, deps.secretStore, run, run.id),
          loadRunCodeRedactions(deps.prisma, deps.secretStore, run, run.id),
        ]);
        const historySearchBeforeSeq =
          contextStrategy !== "current" && run.sourceMessageId
            ? (messages.find((message) => message.id === run.sourceMessageId)?.seq ??
              (
                await deps.prisma.message.findUnique({
                  where: { id: run.sourceMessageId, threadId: thread.id },
                  select: { seq: true },
                })
              )?.seq ??
              thread.nextMessageSeq)
            : thread.nextMessageSeq;
        // Encoded forms too: read_file redacts with these values before any shell command runs.
        runSecrets.push(...commandCredentialRedactions(initialBotCommandEnvironment));
        // A login filled in an earlier run may still be on its page, and anything this run reads
        // or is given may contain it, so every run hides its saved passwords before the model runs.
        runSecrets.push(
          ...savedLoginPasswordRedactions,
          ...purchaseRedactions,
          ...runLoginRedactions,
          ...runCodeRedactions,
        );
        const agentEnvironmentInstruction = formatAgentEnvironmentInstruction(
          initialBotCommandEnvironment,
        );
        // modelPinned distinguishes the captured choice from an attempt's recorded model.
        const modelChoice = runModelChoice(run, bot);
        const hasModelOverride = Boolean(modelChoice.modelProvider && modelChoice.modelId);
        const overrideCredential =
          !pinnedComputerModels && hasModelOverride && modelChoice.modelProvider
            ? await findConnectedModelCredential(
                deps.prisma,
                deps.secretStore,
                run,
                modelChoice.modelProvider,
                modelChoice.modelId,
              )
            : null;
        runAbortController = new AbortController();
        if (!lease.valid) runAbortController.abort();
        if (deps.shutdownSignal?.aborted) runAbortController.abort(deps.shutdownSignal.reason);
        const onShutdown = () => runAbortController?.abort(deps.shutdownSignal?.reason);
        deps.shutdownSignal?.addEventListener("abort", onShutdown);
        detachShutdown = () => deps.shutdownSignal?.removeEventListener("abort", onShutdown);
        const composioRows = storedConnections.filter(
          (connection) => connection.connectorId === "composio",
        );
        let liveSlugs: string[] = [];
        if (needsLivePluginSync(composioRows)) {
          const listing = await loadLivePluginSlugs(deps.listConnectedPluginSlugs, run.userId);
          if (listing.ok) {
            liveSlugs = listing.slugs;
            await persistLivePluginConnections(deps.prisma, run, composioRows, listing.slugs).catch(
              () => undefined,
            );
          }
        }
        const connectedComposio = mergeConnectedPlugins(composioRows, liveSlugs);
        const connectedPlugins = selectRunConnections(
          storedConnections,
          connectedComposio.map((connection) => connection.provider),
        );
        const context = {
          operationId: runId,
          traceId: runId,
          spaceId: run.spaceId,
          userId: run.userId,
          botId: bot.id,
          runId,
          screenLeaseId: screenLeaseIdForRun(null, runId, fence),
          signal: runAbortController.signal,
          ...connectedContext(connectedPlugins),
          connectedProviders: connectedComposio.map((row) => row.provider),
        };
        // The asker's own memory reaches only a chat with no one else in it.
        const soloChat = thread._count.members <= 1;
        const memoryScope: MemoryScope = soloChat
          ? { kind: "person", userId: run.userId }
          : { kind: "chat", threadId: thread.id };
        const semanticMemory: SemanticMemoryProvider | null = configuredMemory?.provider ?? null;

        await deps.events.append({
          spaceId: run.spaceId,
          threadId: thread.id,
          botId: bot.id,
          type: "run.started",
          runId,
          payload: { trigger: run.trigger, routineId: run.routineId },
        });

        const discoveredPromise = deps.connector
          ? deps.connector.discoverTools(context)
          : Promise.resolve([]);
        // A chat with several people: who wrote each message, so the model can tell them apart.
        // A chat with one person stays plain turns.
        const people = await loadChatPeople(
          deps.prisma,
          thread._count.members,
          run.userId,
          messages,
        );
        const speakers = chatSpeakers(bot.id, people);
        const threadContext = threadContextForRun(
          run.trigger,
          {
            messages: [...messages].reverse().map((m) => {
              const speaker = historySpeaker(speakers, m);
              // Turns from several speakers are joined, so no line may pose as a label.
              const text = speakers
                ? neutralizeSpeakerLabels(messageToAgentHistoryText(m))
                : messageToAgentHistoryText(m);
              return {
                id: m.id,
                createdAt: m.createdAt?.toISOString(),
                seq: m.seq,
                role: (m.role === "user" ? "user" : m.role === "system" ? "system" : "assistant") as
                  | "user"
                  | "assistant"
                  | "system",
                ...(speaker ? { speaker } : {}),
                waiting: m.steeringMessages.length > 0,
                content: isPartialReplyClientNonce(m.clientNonce)
                  ? `${text}\n\n${PARTIAL_REPLY_NOTE}`
                  : text,
              };
            }),
            summary: thread.historyCompactionSummary,
            historyCompactedUpToSeq: thread.historyCompactedUpToSeq,
          },
          run.sourceMessageId,
        );
        const compactedHistory = selectCompactedHistory({
          messages: threadContext.messages,
          summary: threadContext.summary,
          historyCompactedUpToSeq: threadContext.historyCompactedUpToSeq,
        });
        let history = compactedHistory.history.map(({ id, role, content, createdAt, speaker }) => ({
          id,
          createdAt,
          role,
          content,
          ...(speaker ? { speaker } : {}),
        }));
        const historyMessages = messages
          .filter((message) => message.steeringMessages.length === 0)
          .map((message) => ({
            id: message.id,
            role: message.role,
            runId: message.runId,
            blocks: message.blocks as MessageBlock[],
          }));
        const currentTurnMessage = userTurnMessageForRun(
          run.trigger,
          runId,
          historyMessages,
          run.sourceMessageId,
        );
        const turnBlocks = currentTurnMessage?.blocks;
        // A run owns its source message and steering bound to it, including waiting-input
        // replies. message.runId alone is display linkage: a send during background work
        // points at that run but waits for its continuation. Read independently of history.
        const currentRunImageMessages = await deps.prisma.message.findMany({
          where: {
            threadId: thread.id,
            OR: [
              ...(run.sourceMessageId ? [{ id: run.sourceMessageId }] : []),
              { steeringMessages: { some: { runId, botId: run.botId } } },
            ],
            role: "user",
            blocks: { array_contains: [{ kind: "image" }] },
          },
          select: { id: true, blocks: true },
          orderBy: { seq: "asc" },
        });
        // The content extension decrypts imageHandling after filtering on plain kind.
        const confirmedRunImages = currentRunImageMessages.flatMap((message) =>
          (message.blocks as MessageBlock[]).filter(
            (block) => block.kind === "image" && block.imageHandling === "confirm",
          ),
        );
        const currentRunRequiresImageInput = confirmedRunImages.length > 0;
        const allowSilentEmptyRun = runAllowsSilentEmpty(run.trigger);
        const recallPromise =
          threadContext.includeSemanticRecall &&
          semanticMemory &&
          thread.historyCompactedUpToSeq != null
            ? semanticMemory.recall(
                {
                  query: task.prompt,
                  scope: memoryScope,
                  history: { threadId: thread.id, generation: thread.historyCompactionGeneration },
                  limit: MAX_RECALLED_MEMORIES,
                },
                context,
              )
            : Promise.resolve(null);
        const [discovered, currentTurnImages, memoryContext, recalled] = await Promise.all([
          discoveredPromise,
          loadCurrentTurnImages(deps, turnBlocks, context),
          loadAgentMemoryContext(
            deps.memory,
            { threadId: thread.id, ...(soloChat ? { personUserId: run.userId } : {}) },
            context,
          ),
          recallPromise,
        ]);
        const semanticMemoryEnabled = Boolean(semanticMemory);
        let recalledMemory = "";
        let recallSucceeded = false;
        if (recalled) {
          if (recalled.ok && recalled.value.length > 0) {
            recallSucceeded = true;
            recalledMemory = formatRecalledMemory(recalled.value);
          } else if (!recalled.ok) {
            getLogger().error("semantic memory recall failed", recalled.error);
          }
        }
        if (!compactedHistory.usedLocalSummary) {
          history = history.slice(
            -historyWindowSize({
              semanticMemoryEnabled: semanticMemoryEnabled && !thread.historyCompactionSummary,
              compacted: thread.historyCompactedUpToSeq != null,
              recallSucceeded,
            }),
          );
        }
        const runDeployment = deps.deploymentModelConfigured ? resolveDeploymentModel() : null;
        const runtimeFallback = runtimeFallbackModel(deps.runtime);
        const pinError =
          !pinnedComputerModels && run.modelPinned
            ? pinnedModelCredentialError(modelChoice, overrideCredential)
            : undefined;
        const modelDefaults = { settings, deployment: runDeployment };
        const selected = pinnedComputerModels
          ? {
              provider: pinnedComputerModels.main.provider,
              id: pinnedComputerModels.main.id,
              thinkingLevel: pinnedComputerModels.main.thinkingLevel,
              credential: null,
            }
          : selectConfiguredModel({
              override: modelChoice,
              overrideCredential,
              main,
              defaults: modelDefaults,
            });
        // The asker's own default, for when Doodle's model does not run on their connections.
        const ownDefault =
          !pinnedComputerModels && !run.modelPinned && hasModelOverride
            ? selectConfiguredModel({
                override: null,
                overrideCredential: null,
                main,
                defaults: modelDefaults,
              })
            : null;
        const selectedProvider = selected.provider ?? runtimeFallback?.provider;
        const selectedModelId = selected.id ?? runtimeFallback?.id;
        // A missing or refused connection of the user's own fails every scheduled run alike.
        const failRunBeforeModel = async (message: string, accountFailure = false) => {
          const failed = await failRunBeforeTurn(
            deps,
            run,
            { attemptId: attempt.id, workerId, fence },
            message,
          );
          if (failed && accountFailure && run.trigger === "routine" && run.routineId) {
            await backOffRoutineAfterAccountError(deps, {
              routineId: run.routineId,
              userId: run.userId,
            });
          }
        };
        if (pinnedComputerFailure) {
          await failRunBeforeModel(pinnedComputerFailure, true);
          return;
        }
        if (pinError) {
          await failRunBeforeModel(pinError, pinError === PINNED_PROVIDER_NOT_CONNECTED);
          return;
        }
        if (
          !pinnedComputerModels &&
          run.modelPinned &&
          (selected.provider !== modelChoice.modelProvider || selected.id !== modelChoice.modelId)
        ) {
          await failRunBeforeModel(PINNED_PROVIDER_NOT_CONNECTED, true);
          return;
        }
        const scripted = deps.runtime.describe().capabilities.scripted;
        let backupChoices: Promise<ModelRoleChoice[]> | undefined;
        const loadBackups = () =>
          (backupChoices ??= scripted
            ? Promise.resolve([])
            : effectiveModelRole(deps.prisma, run, "main", {
                settings,
                deployment: runDeployment,
              }).then(
                (role) => role.backups,
                (error: unknown) => {
                  getLogger().warn("Backup models could not be loaded", { runId, error });
                  return [];
                },
              ));
        // Backups that could not start here are not offered again once the model runs.
        const backupsUnavailable = new Set<ModelRoleChoice>();
        // A main model with no connection, or whose provider refused its sign-in, runs on the
        // first backup that starts. A pinned run asked for its model and keeps it.
        const startOnBackup = async (): Promise<
          | {
              provider: string;
              id: string;
              credential: ModelCredential;
              thinkingLevel: AgentRunRequest["model"]["thinkingLevel"];
              resolved: Awaited<ReturnType<typeof resolveModelKey>>;
            }
          | undefined
        > => {
          if (run.modelPinned) return undefined;
          for (const choice of await loadBackups()) {
            try {
              const backup = await resolveConnectedModelKey(
                deps,
                run,
                choice.provider,
                choice.modelId,
                (values) => runSecrets.push(...values),
                true,
                choice.credentialId,
              );
              getLogger().warn("model.primary_unavailable.backup_used", {
                runId,
                "model.provider": choice.provider,
                "model.id": choice.modelId,
              });
              return {
                provider: choice.provider,
                id: choice.modelId,
                credential: backup.credential,
                thinkingLevel: (choice.thinkingLevel ??
                  null) as AgentRunRequest["model"]["thinkingLevel"],
                resolved: backup.resolved,
              };
            } catch {
              // Resolver errors can carry credential details, so only the outcome is kept.
              backupsUnavailable.add(choice);
            }
          }
          return undefined;
        };
        let start: Awaited<ReturnType<typeof startOnBackup>>;
        let primaryFailure = { message: MISSING_MODEL_RUN_ERROR, accountFailure: true };
        let retryPrimary: unknown;
        if (selectedProvider && selectedModelId) {
          try {
            start = {
              provider: selectedProvider,
              id: selectedModelId,
              credential: selected.credential,
              thinkingLevel: selected.thinkingLevel,
              resolved: pinnedComputerModels
                ? {
                    ...pinnedComputerModels.main,
                    apiKey: pinnedComputerModels.main.apiKey,
                    oauth: pinnedComputerModels.main.oauth?.credential,
                    persistOAuth: pinnedComputerModels.main.oauth?.persist,
                    refreshOAuth: pinnedComputerModels.main.oauth?.refresh,
                    retireOAuth: pinnedComputerModels.main.oauth?.retire,
                    redact: [],
                  }
                : await resolveModelKey(
                    deps,
                    run.userId,
                    run.spaceId,
                    selected.credential,
                    selectedProvider,
                    selectedModelId,
                    (values) => runSecrets.push(...values),
                  ),
            };
          } catch (error) {
            // An incompatible saved model or a dead (already retired) credential is a
            // configuration error: record it on the run rather than retrying setup.
            const terminal = isTerminalModelSetupError(error);
            if (!terminal && !isModelCredentialRejected(error)) throw error;
            primaryFailure = {
              message: error instanceof Error ? error.message : "Connect the provider again.",
              accountFailure: isRetiredModelCredentialError(error),
            };
            if (!terminal) retryPrimary = error;
          }
        }
        const ownProvider = ownDefault?.provider ?? runtimeFallback?.provider;
        const ownModelId = ownDefault?.id ?? runtimeFallback?.id;
        if (
          !start &&
          ownDefault &&
          ownProvider &&
          ownModelId &&
          (ownProvider !== selectedProvider || ownModelId !== selectedModelId)
        ) {
          try {
            start = {
              provider: ownProvider,
              id: ownModelId,
              credential: ownDefault.credential,
              thinkingLevel: ownDefault.thinkingLevel,
              resolved: await resolveModelKey(
                deps,
                run.userId,
                run.spaceId,
                ownDefault.credential,
                ownProvider,
                ownModelId,
                (values) => runSecrets.push(...values),
              ),
            };
          } catch (error) {
            if (!isTerminalModelSetupError(error) && !isModelCredentialRejected(error)) throw error;
          }
        }
        start ??= await startOnBackup();
        if (!start) {
          if (retryPrimary) throw retryPrimary;
          await failRunBeforeModel(primaryFailure.message, primaryFailure.accountFailure);
          return;
        }
        const {
          provider: runModelProvider,
          id: runModelId,
          credential,
          thinkingLevel,
          resolved,
        } = start;
        runSecrets.push(...resolved.redact);
        // A pin stays as it was created. Unpinned runs still record the model they
        // used; modelPinned is what keeps that record from becoming the next choice.
        if (!run.modelPinned) {
          await deps.prisma.run.updateMany({
            where: { id: runId, status: "running", leaseOwner: workerId, leaseFence: fence },
            data: { modelProvider: runModelProvider, modelId: runModelId },
          });
        }

        // The asker's own computer in this workspace. A run that never needs it neither makes
        // one nor waits for it; the first real use makes it, leases it and starts it.
        const computerOwner = { spaceId: run.spaceId, userId: run.userId };
        let storedComputer = await findPersonComputer(deps.prisma, computerOwner);
        const plannedComputer = storedComputer ?? {
          kind: await newComputerKind(deps.prisma),
          homeKey: computerHomeKey(computerOwner),
        };
        const computerRecord = () => {
          if (!storedComputer) throw new Error("The run has not started its computer");
          return storedComputer;
        };
        const artifacts = deps.artifacts;
        const recentFilesInput = {
          context,
          skipMessageId: currentTurnMessage?.id,
          maxTurns: RECENT_TURN_IMAGE_TURNS,
        };
        // Files from earlier messages that history tools surfaced this run.
        const earlierFiles = createEarlierFileQueue();
        const runComputer = lazyRunComputer(
          async () => {
            getLogger().info("computer.requested");
            const record =
              storedComputer ?? (await ensurePersonComputer(deps.prisma, computerOwner));
            storedComputer = record;
            computerLease = await waitForComputerExecutionLease(
              deps.prisma,
              { computerId: record.id, runId, workerId, runFence: fence },
              context.signal,
            );
            context.screenLeaseId = screenLeaseIdForRun(computerLease, runId, fence);
            const computer = await provisionComputer(deps, record.id, context, "bot");
            earlierFiles.computerStarted();
            computerUse.screenRelease = { computer, context, keepWarm: false };
            recordComputerDisk(deps, record.id, computer, context);
            scheduleComputerSleep(deps.jobs, record.id);
            // Earlier attachments wait for the computer's first use; every start copies them
            // again, so they need no checkpoint, and each copy logs and skips its own failure.
            if (artifacts) {
              await materializeRecentThreadFiles({ ...deps, artifacts }, history, historyMessages, {
                ...recentFilesInput,
                computer: async () => computer,
              });
            }
            return computer;
          },
          () => runAbortController?.abort(),
        );
        const computerKind =
          (await deps.sandbox.provisionKind?.(plannedComputer.homeKey)) ?? plannedComputer.kind;
        const workspaceCheckpoint = createRunWorkspaceCheckpoint(
          async () => {
            if (!runComputer.ready) return;
            await checkpointAndRecordComputerWorkspace(
              deps,
              computerRecord(),
              runComputer.ready,
              context,
            );
          },
          { id: storedComputer?.id ?? plannedComputer.homeKey, kind: computerKind },
          context.signal,
        );
        const pendingTurnFiles: MessageBlock[][] = [turnBlocks ?? []];
        let copyingTurnFiles = Promise.resolve();
        // Serialize copies before each tool, including attachments received while a boot is in flight.
        const getRunComputer = async (reason: "tool" | "takeover" | "script", tool?: string) => {
          if (computerUse.reason === "none") {
            computerUse.reason = reason;
            computerUse.tool = tool && BUILTIN_AGENT_TOOL_NAMES.has(tool) ? tool : undefined;
          }
          return getLogger().withContext(
            {
              reason: computerUse.reason,
              tool: computerUse.tool,
              trigger: run.trigger,
              "run.id": runId,
              ...(storedComputer ? { "computer.id": storedComputer.id } : {}),
            },
            async () => {
              const computer = await runComputer.get();
              copyingTurnFiles = copyingTurnFiles
                .catch(() => undefined)
                .then(async () => {
                  while (artifacts && pendingTurnFiles.length) {
                    const files = await materializeCurrentTurnFiles(
                      { ...deps, artifacts },
                      pendingTurnFiles[0],
                      {
                        context,
                        computer: async () => computer,
                        markWorkspaceDirty: workspaceCheckpoint.markDirty,
                      },
                    );
                    workspaceCheckpoint.markFiles(files);
                    pendingTurnFiles.shift();
                  }
                  const earlier = earlierFiles.take();
                  if (artifacts && earlier.length) {
                    earlierFiles.copiedTo(
                      earlier,
                      // Saved with the run's checkpoint, so a resumed attempt still has them.
                      await materializeEarlierFiles({ ...deps, artifacts }, earlier, {
                        context,
                        computer: async () => computer,
                        markWorkspaceDirty: workspaceCheckpoint.markDirty,
                      }),
                    );
                  }
                });
              await copyingTurnFiles;
              return computer;
            },
          );
        };
        let currentTurnFiles: Awaited<ReturnType<typeof listCurrentTurnFiles>> = [];
        let recentThreadFiles: Awaited<ReturnType<typeof listRecentThreadFiles>> = [];
        try {
          if (artifacts) {
            currentTurnFiles = await listCurrentTurnFiles(deps, turnBlocks, context);
            recentThreadFiles = await listRecentThreadFiles(
              deps,
              history,
              historyMessages,
              recentFilesInput,
            );
          }
        } catch (error) {
          await workspaceCheckpoint.flush().catch(() => undefined);
          throw error;
        }
        const attachedFilesPrompt = [
          currentTurnFilesInstruction(currentTurnFiles),
          recentThreadFilesInstruction(recentThreadFiles),
        ]
          .filter(Boolean)
          .join("\n\n");
        const graphical =
          computerKind !== "desktop" && deps.sandbox.describe().capabilities.graphical;
        // Gate on the pair written to the run row above; re-deriving it would drop the
        // deployment fallback and gate a vision-capable default as text-only.
        const modelSeesImages = modelAcceptsImageInput(
          runModelProvider,
          runModelId,
          resolved.acceptsImages,
        );

        const paymentWallet = deps.paymentWallet;
        const paymentWalletEnabled = paymentWallet
          ? await paymentWalletConnected(
              { prisma: deps.prisma, secretStore: deps.secretStore, paymentWallet },
              run.userId,
            )
          : false;
        if (heldForTakeover) {
          const held = await deps.prisma.run.findUnique({
            where: { id: runId },
            select: { status: true, checkpoint: true },
          });
          if (held) {
            ({ resumeCheckpoint, heldForTakeover, takeoverResume } = refreshTakeoverContinuePlan(
              { resumeCheckpoint, heldForTakeover, takeoverResume },
              held,
            ));
          }
        }
        const mainRunModel: AgentRunRequest["model"] = pinnedComputerModels?.main ?? {
          provider: runModelProvider,
          id: runModelId,
          ...(credential ? { connectionId: credential.id } : {}),
          ...resolvedModelRunFields(resolved),
          thinkingLevel: thinkingLevel ?? resolved.thinkingLevel ?? null,
        };
        // Saved identities win on resume, including when the setting was cleared meanwhile.
        const computerModel =
          pinnedComputerModels?.computer ??
          // A paused turn resumes with the models it started with, even one saved before this setting.
          (scripted || storedTurnCheckpoint || !graphical
            ? undefined
            : await resolveComputerRunModel(
                {
                  prisma: deps.prisma,
                  resolve: resolveCheckpointModel,
                  connectionFor: async (provider, modelId) =>
                    (
                      await findConnectedModelCredential(
                        deps.prisma,
                        deps.secretStore,
                        run,
                        provider,
                        modelId,
                      )
                    )?.id,
                },
                { userId: run.userId, spaceId: run.spaceId },
                mainRunModel,
              ));
        const sourceMessage =
          (run.trigger === "user" || run.trigger === "follow_up") && run.sourceMessageId
            ? await deps.prisma.message.findUnique({
                where: { id: run.sourceMessageId },
                select: { role: true, blocks: true, threadId: true },
              })
            : null;
        const ownerStartedRun = isPersonStartedRun(run.trigger, sourceMessage?.role === "user");
        const acceptsImages =
          deps.runtime.describe().capabilities.scripted ||
          modelSeesImages ||
          Boolean(computerModel || checkpointModelResolver);
        const graphicalToolsAllowed = graphical && acceptsImages && !heldForTakeover;
        const pageBrowserAllowed =
          graphical && browser.describe().capabilities.page && !heldForTakeover;
        const disabledBuiltinTools = disabledBuiltinToolSet(bot.disabledBuiltinTools);
        const userComputerOwnerId = userComputerOwner({
          trigger: run.trigger,
          sourceRole: sourceMessage?.role,
          runUserId: run.userId,
        });
        let userComputer: UserComputerState;
        let userComputerScreen = false;
        if (
          userComputerOwnerId &&
          deps.userDevices &&
          !disabledBuiltinTools.has(USER_COMPUTER_SHELL_TOOL)
        ) {
          const device = await deps.userDevices.connected(userComputerOwnerId).catch(() => null);
          if (device) {
            userComputer = "connected";
            // The macOS and Windows desktops fetch a screen driver; Linux has none yet.
            userComputerScreen = device.platform === "darwin" || device.platform === "win32";
          } else userComputer = "offline";
        }
        const builtins = [
          ...selectBuiltinToolsForRun({
            historyRetrievalEnabled: contextStrategy !== "current",
            graphicalToolsAllowed,
            pageBrowserAllowed,
            soloChat,
            trigger: run.trigger,
            semanticMemoryEnabled,
            semanticMemoryForgets: Boolean(semanticMemory?.forget),
            mediaImagesEnabled: Boolean(deps.artifacts && mediaGeneration?.capabilities.images),
            mediaVideoEnabled: Boolean(deps.artifacts && mediaGeneration?.capabilities.video),
            cloudAgentEnabled: cloudAgentsEnabled(cloudAgent, run.spaceId),
            paymentWalletEnabled,
            disabledBuiltinTools: bot.disabledBuiltinTools,
            followUpFromUser: sourceMessage?.role === "user",
            userComputer: userComputer === "connected",
            userComputerScreen,
          }),
        ];
        const exposedConnectorTools = discovered.filter(
          (tool) => !builtinAgentTools.some((builtin) => builtin.name === tool.name),
        );
        const connectorTools = new Map(
          exposedConnectorTools.map((tool) => [tool.name, tool] as const),
        );
        const trustLoaders = createRunTrustLoaders(deps, {
          run,
          runId,
          botId: bot.id,
          taskPrompt: task.prompt,
          ownerStartedRun,
          sourceMessage,
          connectedPlugins,
        });
        // Outbound destinations this run may reach without asking. See outboundSiteGate and
        // connectorReadRequiresApproval; approvals from earlier attempts are read back from effects.
        const searchResultUrls = new Set<string>();
        const initiallyTainted =
          !ownerStartedRun || Boolean(turnCheckpoint) || Boolean(checkpointLoadError);
        const tools = [...builtins, ...exposedConnectorTools];
        const taskCatalogInstruction = tools.some((tool) => tool.name === "task_catalog")
          ? TASK_CATALOG_GUIDANCE
          : undefined;
        const approvedEffects = await deps.prisma.externalEffect.findMany({
          where: { runId, status: "approved" },
          orderBy: APPROVED_EFFECT_REPLAY_ORDER,
          select: { kind: true, request: true, idempotencyKey: true },
        });
        const approvedEffectReplays = createApprovedEffectReplayQueue(approvedEffects);
        const baseComputerInstruction = persistentComputerInstruction({
          heldForTakeover,
          graphicalToolsAllowed,
          graphical,
          disabled: disabledBuiltinTools,
        });
        const dockerToolInstruction = dockerComputerToolInstruction(
          computerKind,
          disabledBuiltinTools,
        );
        const hostEnvironment =
          computerKind && usesNativeShell(computerKind)
            ? await deps.sandbox
                .environment?.(
                  {
                    id:
                      storedComputer?.providerRef ?? storedComputer?.id ?? plannedComputer.homeKey,
                    botId: plannedComputer.homeKey,
                    kind: computerKind as ComputerRef["kind"],
                    providerRef: storedComputer?.providerRef ?? "",
                  },
                  {
                    ...context,
                    signal: AbortSignal.any([context.signal, AbortSignal.timeout(2000)]),
                  },
                )
                .catch(() => undefined)
            : undefined;
        const hostShell = hostEnvironment
          ? `Home: ${JSON.stringify(hostEnvironment.home)}. Shell: ${JSON.stringify(hostEnvironment.shell)}. The shell tool executes commands with that shell. Use its native syntax, paths and installed tools; do not assume Linux or bash.`
          : undefined;
        const hostInstruction = !hostEnvironment
          ? undefined
          : computerKind === "wuying"
            ? `Commands run on a Windows cloud computer. ${hostShell} Files outside the bot workspace can be accessed through commands. The screen shows the Windows desktop; use the graphical tools for apps without a command line.`
            : `Commands run on the user's ${hostEnvironment.platform} computer with their account permissions. ${hostShell} Local files outside the bot workspace can be accessed through commands. App launching is available through OS commands; graphical screen control is unavailable.`;
        const computerInstruction = [
          "Use the computer only when the task needs files, commands, a browser, or an installed application. Answer directly from the conversation when sufficient; use connected tools for app data. A website with no connected app is still yours to use in the computer's browser, now and in scheduled routines, so a missing connection alone is never a reason to decline. Do not inspect the computer just to prepare for an unrelated task. If what you are about to buy, send or submit differs from what the user confirmed, such as a changed item or total, show the difference and confirm again first.",
          hostInstruction
            ? `${baseComputerInstruction} ${hostInstruction}`
            : dockerToolInstruction
              ? `${baseComputerInstruction} ${dockerToolInstruction}`
              : baseComputerInstruction,
          storedComputer ? diskNoteInstruction(storedComputer) : undefined,
        ]
          .filter(Boolean)
          .join(" ");
        const workspaceInstruction =
          "The computer is the asking person's own. Relative file paths and shell working directories start at its home.";

        const reply = await createReplyState(deps, run, runSecrets);
        const script = scripted ? inferScript(task.prompt, takeoverResume?.checkpoint) : undefined;
        const state: RunState = {
          lease,
          computerUse,
          runningHelpers,
          reply,
          approval: { pausePending: false, request: undefined },
          effects: {
            counts: new Map(),
            occurrences: [],
            restoredPending: undefined,
            consumedIds: new Set(),
            pendingTurnCheckpoints: new Map(),
            storedTurnCheckpoint,
          },
          screen: { lastFrameId: undefined, unchangedVisualStreak: { count: 0 } },
          toolCallStreak: { key: undefined, count: 0 },
          overLimitActionCalls: 0,
          toolResults: new Map(),
          tainted: initiallyTainted,
          ownerSettingsRefused: false,
          // A resumed turn replaces this with the baseline its saved prompt was built from.
          ownInstructionsBaseline: bot.instructions ?? "",
          earlierAttempt: undefined,
          walletHosts: new Set(),
          terminalCheckpointComplete: false,
        };
        const { effects } = state;

        const ctx: RunContext = {
          deps,
          providers: { web, mediaGeneration, browser, cloudAgent },
          run,
          runId,
          workerId,
          fence,
          attempt,
          bot,
          thread,
          task,
          context,
          abortController: runAbortController,
          secrets: runSecrets,
          source: {
            ownerStartedRun,
            historySearchBeforeSeq,
            myChatsAllowed: historyMyChatsAllowed(run, sourceMessage, soloChat),
            userComputerOwner: userComputerOwnerId,
          },
          computer: {
            stored: plannedComputer,
            record: computerRecord,
            kind: computerKind,
            lease: () => computerLease,
            lazy: runComputer,
            get: getRunComputer,
            copyEarlierFiles: earlierFiles.add,
            checkpoint: workspaceCheckpoint,
            hostEnvironment,
            graphical,
            graphicalToolsAllowed,
            pageBrowserAllowed,
            acceptsImages,
            heldForTakeover,
          },
          tools: {
            offered: tools,
            builtins,
            connector: connectorTools,
            disabled: disabledBuiltinTools,
            connectedPlugins,
            approvedReplays: approvedEffectReplays,
          },
          trust: { ...trustLoaders, searchResultUrls },
          memory: { semantic: semanticMemory, scope: memoryScope },
          soloChat,
          scripted,
          script,
          allowSilentEmptyRun,
          state,
          settleRunningHelpers: settleHelpers,
          stopHeartbeatAfterCompletion,
        };
        const pluginLine =
          connectedPlugins.length > 0
            ? `Connected plugins: ${connectedPlugins.map((row) => `${row.displayName} (${row.connectorId}:${row.provider})`).join(", ")}. Prefer those plugin tools over the computer browser or web search when reading app data (repos, releases, mail, calendar, and similar).`
            : "No plugins are connected yet.";
        const runSavedSkills = savedSkills;
        const runAgentSkills = agentSkills;
        const taughtSkillIndex = runSavedSkills.slice(0, 20);
        const taughtSkillsLine =
          taughtSkillIndex.length > 0
            ? `Saved taught skills:\n${taughtSkillIndex
                .map((skill) => {
                  const playbook = parsePlaybook(skill.playbook);
                  const name = skill.name || skill.goal.slice(0, 80);
                  return `- ${name}: ${playbook.whenToUse || skill.goal}`;
                })
                .join(
                  "\n",
                )}\nWhen the user asks to run a taught skill by name, follow that skill's playbook exactly. The full playbook is included in the user task when they invoke it.`
            : undefined;
        const agentSkillsLine = formatSkillsCatalogInstruction(runAgentSkills);
        const missingImagesInstruction = missingTurnImagesInstruction(
          turnBlocks,
          currentTurnImages,
        );
        const taskPrompt = expandSkillReferencesInPrompt(
          [task.prompt, attachedFilesPrompt, missingImagesInstruction].filter(Boolean).join("\n\n"),
          runAgentSkills,
        );
        const invokedSkill = runSavedSkills.find(
          (skill) =>
            // Taught skills are the space's. Only a person's own message may pull in one someone
            // else taught; any other run follows only those its own person taught.
            (ownerStartedRun || skill.userId === run.userId) &&
            promptInvokesSkill(taskPrompt, skill.name || skill.goal),
        );
        const basePrompt = invokedSkill
          ? `${formatSkillRunPrompt(
              invokedSkill.name || invokedSkill.goal.slice(0, 80),
              parsePlaybook(invokedSkill.playbook),
            )}\n\n${taskPrompt}`
          : taskPrompt;
        if (turnCheckpoint) {
          turnCheckpoint = restoreTurnCheckpointEffects(
            ctx,
            turnCheckpoint,
            {
              provider: runModelProvider,
              id: runModelId,
            },
            savedComputerMode?.mode,
          );
          if (checkpointModelResolver && !turnCheckpoint)
            throw new Error(
              "Pinned computer mode checkpoint cannot resume with the available tools",
            );
        }
        const approvalContinuation = turnCheckpoint
          ? undefined
          : buildApprovalContinuation(
              approvedEffects,
              (request) => redactSecrets(JSON.stringify(request), runSecrets),
              { exposedToolNames: new Set(partitionTools(tools).listed.map((tool) => tool.name)) },
            );
        const replyContext = await loadReplyContext(deps.prisma, thread.id, run.sourceMessageId);
        let userTimeZone: string | null | undefined;
        try {
          userTimeZone = (
            await deps.prisma.user.findUnique({
              where: { id: run.userId },
              select: { timezone: true },
            })
          )?.timezone;
        } catch {
          // Timezone is optional context; a lookup failure must not prevent a run.
        }
        let lateRoutineNote: string | undefined;
        const lateSince = current.lateSince ?? firstLateSince;
        if (lateSince && run.routineId) {
          try {
            const routine = await deps.prisma.routine.findUnique({
              where: { id: run.routineId },
              select: { timezone: true },
            });
            if (routine)
              lateRoutineNote = lateRoutineRunInstruction(
                lateSince,
                executionStartedAt,
                routine.timezone,
              );
          } catch {
            // Lateness is optional context; a lookup failure must not prevent a run.
          }
        }
        const sharedChatNote = people
          ? await loadSharedChatNote(deps.prisma, thread.id, run.userId)
          : undefined;
        const prompt = [
          replyContext,
          run.trigger === "reaction" && replyContext ? undefined : basePrompt,
          takeoverResume?.promptNote,
          approvalContinuation,
          // Per-turn, not in the system prompt: the timestamp changes every call and would break the cacheable prefix.
          formatCurrentTimeInstruction(deps.now?.() ?? new Date(), userTimeZone),
          lateRoutineNote,
          sharedChatNote,
        ]
          .filter(Boolean)
          .join("\n\n");
        const historicalContext: AgentRunRequest["history"] = [];
        if (compactedHistory.usedLocalSummary && compactedHistory.summary) {
          historicalContext.push({
            role: "user",
            content: redactSecrets(
              formatCompactedSummary(compactedHistory.summary, thread.historyCompactedUpToSeq!),
              runSecrets,
            ),
          });
        }
        if (recalledMemory) {
          historicalContext.push({
            role: "user",
            content: redactSecrets(recalledMemory, runSecrets),
          });
        }
        const modelImageBudget =
          resolved.maxImagesPerPrompt === undefined
            ? undefined
            : Math.max(0, resolved.maxImagesPerPrompt - (currentTurnImages?.length ?? 0));
        // A text-only model keeps the [image:] marker. Putting image parts in
        // history makes the provider reject a follow-up that used to be text.
        const historyWithImages = modelSeesImages
          ? await withRecentTurnImages(deps, history, historyMessages, context, {
              skipMessageId: currentTurnMessage?.id,
              maxImages: modelImageBudget,
            })
          : history;
        const runtimeHistory = [...historicalContext, ...historyWithImages];

        if (heldForTakeover) {
          const releasedCheckpoint = takeoverCheckpointOf(
            (
              await deps.prisma.run.findUnique({
                where: { id: runId },
                select: { checkpoint: true },
              })
            )?.checkpoint,
          );
          if (releasedCheckpoint) {
            await requeueComputerRun(deps, runId, workerId, fence, releasedCheckpoint, false);
            return;
          }
        }

        // Stop during setup must not still open the model. A reclaimed lease can
        // leave status "running" under a new owner, and the stream loop only
        // notices cancellation after the provider request has started.
        const beforeModel = await deps.prisma.run.findUnique({
          where: { id: runId },
          select: { status: true, leaseOwner: true, leaseFence: true },
        });
        if (
          !mayOpenModelStream(
            beforeModel,
            workerId,
            fence,
            !lease.valid || Boolean(runAbortController?.signal.aborted),
          )
        ) {
          return;
        }

        const verbatimMcpServers = await verbatimMcpServersForRun(deps.prisma, {
          botId: bot.id,
          spaceId: run.spaceId,
          userId: run.userId,
        });
        // The running model is not its own backup, unless another account serves it.
        const fallbackModels = (await loadBackups()).filter(
          (candidate) =>
            !backupsUnavailable.has(candidate) &&
            (candidate.provider !== runModelProvider ||
              candidate.modelId !== runModelId ||
              (candidate.credentialId !== undefined &&
                candidate.credentialId !== mainRunModel.connectionId)),
        );
        const fallbackKey = (provider: string, modelId: string, credentialId?: string | null) =>
          JSON.stringify([provider, modelId, credentialId ?? null]);
        const fallbackModelKeys = new Set(
          fallbackModels.map((candidate) =>
            fallbackKey(candidate.provider, candidate.modelId, candidate.credentialId),
          ),
        );
        const fallbackModelIds = new Set(
          fallbackModels.map((candidate) => fallbackKey(candidate.provider, candidate.modelId)),
        );
        // Provider kind and model id only: custom endpoints are identified by kind, never host.
        const activeModel = { "model.provider": runModelProvider, "model.id": runModelId };
        // Shutdown must not finalize the attempt. The finally block queues the run
        // when this worker still owns it.
        const interruptedByShutdown = async () => {
          if (!deps.shutdownSignal?.aborted) return false;
          if (!ctx.state.terminalCheckpointComplete) {
            await ctx.computer.checkpoint.flush().catch(() => undefined);
          }
          return true;
        };

        try {
          if (checkpointLoadError) throw checkpointLoadError;
          const runtimeEvents = deps.runtime.run(
            {
              botId: bot.id,
              verbatimMcpServers,
              threadId: thread.id,
              runId,
              routineId: run.routineId,
              sourceMessageId: run.sourceMessageId,
              onUsage: async (event) => {
                await recordUsage(deps.prisma, event, {
                  spaceId: run.spaceId,
                  botId: bot.id,
                  userId: run.userId,
                  runId,
                  parentRunId: runId,
                  operationId: runId,
                });
              },
              prompt,
              ...(speakers &&
              (run.trigger === "user" ||
                (run.trigger === "follow_up" && sourceMessage?.role === "user"))
                ? { promptSpeaker: personSpeaker(people, run.userId) }
                : {}),
              // Keep an explicit executor override, but let the runtime select
              // cache-aware context for connections declaring a cache window.
              contextStrategy: deps.contextStrategy,
              instructions: userTurnInstructions({
                botInstructions: runIdentityInstruction(bot),
                redactedMemoryContext: memoryContext
                  ? redactSecrets(memoryContext, runSecrets)
                  : undefined,
                hasHistoricalContext: historicalContext.length > 0,
                historyRetrievalEnabled: contextStrategy !== "current",
                computerInstruction,
                pageBrowserAllowed,
                taskCatalogInstruction,
                workspaceInstruction,
                agentEnvironmentInstruction,
                pluginLine,
                agentSkillsLine,
                taughtSkillsLine,
                replyGuidance: runReplyGuidance(run.trigger),
                disabledBuiltinTools,
                userComputer,
              })
                .filter((instruction): instruction is string => Boolean(instruction))
                .join("\n\n"),
              history: runtimeHistory,
              currentTurnImages,
              currentRunRequiresImageInput,
              currentTurnImageFileFallback: Boolean(
                currentTurnImages?.length &&
                  currentTurnFiles.length &&
                  !turnBlocks?.some(
                    (block) => block.kind === "image" && block.imageHandling === "confirm",
                  ),
              ),
              tools,
              model: mainRunModel,
              computerModel,
              fallbackModels: fallbackModels.map(({ provider, modelId, credentialId }) => ({
                provider,
                id: modelId,
                ...(credentialId ? { connectionId: credentialId } : {}),
              })),
              resolveFallbackModel:
                checkpointModelResolver || fallbackModelKeys.size
                  ? async (provider, modelId, connectionId) => {
                      if (checkpointModelResolver?.has(provider, modelId, connectionId))
                        return checkpointModelResolver(provider, modelId, connectionId);
                      const key = fallbackKey(provider, modelId, connectionId);
                      if (!fallbackModelKeys.has(key))
                        throw new Error("Backup model is not selected");
                      return resolveConnectedModel(
                        { userId: run.userId, spaceId: run.spaceId },
                        provider,
                        modelId,
                        (values) => runSecrets.push(...values),
                        true,
                        fallbackModels.find(
                          (candidate) =>
                            fallbackKey(
                              candidate.provider,
                              candidate.modelId,
                              candidate.credentialId,
                            ) === key,
                        )?.thinkingLevel ?? null,
                        connectionId,
                      );
                    }
                  : undefined,
              onModelChange: async (provider, modelId, computerMode) => {
                const roleModel =
                  [mainRunModel, computerModel].some(
                    (model) => model?.provider === provider && model.id === modelId,
                  ) || checkpointModelResolver?.hasModel(provider, modelId);
                if (!roleModel && !fallbackModelIds.has(fallbackKey(provider, modelId))) {
                  throw new Error("Model is not selected");
                }
                // The run's model is what retries and pins rerun; computer mode is a detour from it.
                if (!computerMode) {
                  const updated = await deps.prisma.run.updateMany({
                    where: {
                      id: runId,
                      status: "running",
                      leaseOwner: workerId,
                      leaseFence: fence,
                    },
                    data: { modelProvider: provider, modelId },
                  });
                  if (updated.count !== 1) {
                    throw new Error("Run lease was lost before the backup model could be used");
                  }
                }
                activeModel["model.provider"] = provider;
                activeModel["model.id"] = modelId;
              },
              resumeFromCheckpoint: takeoverResume?.checkpoint,
              turnCheckpoint,
              onCheckpoint: async (capture, executionId) => {
                effects.pendingTurnCheckpoints.set(executionId, capture);
              },
              resumeToolResult: {
                content: [{ type: "text", text: takeoverResume?.promptNote ?? taskPrompt }],
              },
              script,
              allowSilentEmpty: allowSilentEmptyRun,
              executeTool: scripted
                ? undefined
                : (name, args, executionId, route, observer) =>
                    applyTool(ctx, name, args, executionId, route, observer),
              resolveModel: scripted
                ? undefined
                : (provider, modelId) =>
                    resolveConnectedModel(run, provider, modelId, (values) =>
                      runSecrets.push(...values),
                    ),
              onToolCompleted: (completion) => {
                if (effects.restoredPending?.executionId === completion.executionId)
                  effects.restoredPending = undefined;
                if (!completion.paused)
                  effects.pendingTurnCheckpoints.delete(completion.executionId);
                const audited = appendToolCompletionAudit(
                  deps,
                  {
                    spaceId: run.spaceId,
                    threadId: thread.id,
                    botId: bot.id,
                    runId,
                  },
                  completion,
                  runSecrets,
                );
                state.toolResults.set(
                  completion.executionId,
                  toolResultFingerprint(completion.result, completion.error),
                );
                return audited;
              },
              claimSteering: (seenIds) =>
                claimRunSteering(
                  deps,
                  {
                    threadId: thread.id,
                    botId: bot.id,
                    runId,
                    leaseOwner: workerId,
                    leaseFence: fence,
                  },
                  seenIds,
                  context,
                  pendingTurnFiles,
                  {
                    messageId: currentTurnMessage?.id,
                    hasImages: Boolean(currentTurnImages?.length),
                  },
                ),
            },
            context,
          );
          if (await consumeRunEvents(ctx, runtimeEvents)) return;
          if (await interruptedByShutdown()) return;
          await completeRun(ctx);
        } catch (turnError) {
          if (await interruptedByShutdown()) return;
          const caughtError = turnError;
          await failRun(ctx, caughtError, {
            ownCredential: resolved.ownCredential,
            active: activeModel,
          });
        }
      } catch (setupError) {
        // An abort while stopping is not a setup failure, and must not spend the
        // retry budget that eventually fails the run.
        if (deps.shutdownSignal?.aborted) return;
        const computerBusy = setupError instanceof ComputerBusyError;
        const retryForever = computerBusy || isTooManyDatabaseConnections(setupError);
        const setupMessage = redactSecrets(userRunError(setupError), runSecrets);
        const reportedSetupError = sanitizedError(setupError, (text) =>
          redactSecrets(text, runSecrets),
        );
        // An outage at the computer provider is retried like any setup failure, but is not a
        // Labradoodle bug to report.
        const providerOutage =
          setupError instanceof SandboxUnavailableError ||
          setupError instanceof SandboxUnresponsiveError;
        // A lost lease aborted setup on purpose; whatever that interrupted is not a failure.
        if (providerOutage || !lease.valid) {
          getLogger().warn("run setup failed", { error: reportedSetupError });
        } else if (!computerBusy) {
          getLogger().error("run setup failed", reportedSetupError);
        }
        const priorFailures = retryForever ? 0 : await setupFailureStreak(deps.prisma, runId);
        // The job reconciler re-enqueues a queued run whose job ran out of attempts, so a
        // setup that fails every time would retry forever. End the run instead.
        if (!retryForever && priorFailures >= RUN_SETUP_FAILURE_LIMIT - 1) {
          await failRunBeforeTurn(
            deps,
            run,
            { attemptId: attempt.id, workerId, fence },
            setupMessage,
          );
          return;
        }
        const retryDelay = providerOutage
          ? providerOutageRetryDelay(priorFailures)
          : computerRetryDelay(fence);
        // One instant for the run and its wake-up job, so neither runs before the other.
        const retryAt = new Date(Date.now() + retryDelay);
        const released = await writeComputerRunRequeue(
          deps,
          runId,
          workerId,
          fence,
          resumeCheckpoint,
          heldForTakeover,
          retryForever ? null : "Run setup failed; retrying",
          retryAt,
        );
        if (released) {
          await deps.prisma.attempt.update({
            where: { id: attempt.id },
            data: {
              status: "setup_failed",
              error: retryForever ? null : "Run setup failed; retrying",
              finishedAt: new Date(),
            },
          });
          if (retryForever || dispatchHandedOff) {
            await deps.jobs.enqueue({
              ...runContinueJob(runId),
              availableAt: retryAt,
            });
            return;
          }
          throw new Error("Run setup failed; retrying", { cause: reportedSetupError });
        }
      } finally {
        getLogger().info("run.computer", {
          "run.id": runId,
          trigger: run.trigger,
          reason: computerUse.reason,
          tool: computerUse.tool,
          ready: Boolean(computerUse.screenRelease),
        });
        detachShutdown?.();
        clearInterval(heartbeat);
        // This attempt stopped working on the run. Whether it paused, lost the
        // lease, was invalidated by the heartbeat or never finalised, the run
        // row decides whether this worker's run-scoped state may end: a
        // terminal run, or one another worker owns, never resumes here, while a
        // paused or requeued run keeps its sessions for its next attempt. A
        // successful finalisation already ended the state, and the terminal row
        // this reads then only repeats that.
        if (await runEndedForThisWorker(deps.prisma, { runId, leaseOwner: workerId })) {
          endRunConnectorState(runId);
        }
        if (!lease.retainComputer) {
          if (computerUse.screenRelease) {
            const releaseContext = computerUse.screenRelease.keepWarm
              ? { ...computerUse.screenRelease.context, keepScreenWarm: true }
              : computerUse.screenRelease.context;
            await deps.sandbox
              .releaseScreen?.(computerUse.screenRelease.computer, releaseContext)
              .catch(() => undefined);
          }
          await releaseComputerExecutionLease(deps.prisma, computerLease).catch(() => undefined);
        }
        if (deps.shutdownSignal?.aborted) {
          // A renewal still in flight must not treat this release as a lost lease.
          lease.completed = true;
          await requeueRunAfterShutdown(deps, runId, workerId, fence).catch((error) =>
            getLogger().error("shutdown run requeue", error),
          );
        }
        await deps.prisma.attempt
          .updateMany({
            where: { id: attempt.id, status: "running" },
            data: { status: "interrupted", finishedAt: new Date() },
          })
          .catch(() => undefined);
        await settleHelpers();
      }
    },
  };
}

/**
 * A run acts with its sender's accounts, so it must not start or resume once they have left the
 * chat, nor once Doodle has. Leaving and turning Doodle off cancel runs; this closes the gap for
 * anything that slipped past.
 */
async function cancelRunOfFormerMember(
  deps: ExecutorDeps,
  run: {
    id: string;
    spaceId: string;
    userId: string;
    threadId: string;
    botId: string;
  },
): Promise<boolean> {
  const member = await deps.prisma.threadMember.findFirst({
    where: { threadId: run.threadId, userId: run.userId, thread: { doodle: true } },
    select: { id: true },
  });
  if (member) return false;
  const cancelled = await deps.prisma.$transaction(async (tx) => {
    const current = await tx.run.findUnique({
      where: { id: run.id },
      select: {
        id: true,
        taskId: true,
        userId: true,
        spaceId: true,
        status: true,
      },
    });
    if (!current || isTerminal(current.status as RunStatus)) return null;
    const [stopped] = await cancelRunsInTransaction(tx, [current], new Date());
    if (!stopped) return null;
    const event = await appendEventInTransaction(tx, {
      spaceId: run.spaceId,
      threadId: run.threadId,
      botId: run.botId,
      runId: run.id,
      type: "run.cancelled",
      payload: {},
    });
    // Remaining members' messages waited behind this run; give them their own.
    const continuationId = await createPendingSteeringRun(tx, run);
    return { seq: event.seq, continuationId };
  });
  if (!cancelled) return true;
  await deps.events.notify(run.threadId, cancelled.seq).catch(() => undefined);
  if (cancelled.continuationId) await deps.jobs.enqueue(runContinueJob(cancelled.continuationId));
  return true;
}

/** Whether a run this attempt could not finalize is over for this worker: it
 * reached a terminal state or another worker owns it, so its run-scoped state
 * may end. A run re-claimed by this worker under a newer fence — recovered, or
 * requeued after a pause — keeps its state for its next attempt. */
async function runEndedForThisWorker(
  prisma: ExecutorDeps["prisma"],
  input: { runId: string; leaseOwner: string },
): Promise<boolean> {
  try {
    const run = await prisma.run.findUnique({
      where: { id: input.runId },
      select: { status: true, leaseOwner: true },
    });
    if (!run) return true;
    if (isTerminal(run.status as RunStatus)) return true;
    return run.leaseOwner !== null && run.leaseOwner !== input.leaseOwner;
  } catch {
    // Unknown keeps the state; the connector's idle bound still ends it.
    return false;
  }
}
