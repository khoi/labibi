import type {
  AgentHomeStore,
  AgentRuntime,
  ArtifactStore,
  BackgroundJobExecution,
  BackgroundJobHandlers,
  JobPublisher,
  MediaGenerationProvider,
  PaymentWalletProvider,
  SandboxProvider,
  SecretStore,
} from "@labradoodle/adapter-kit";
import {
  SandboxRateLimitError,
  SandboxUnavailableError,
  SandboxUnresponsiveError,
} from "@labradoodle/adapter-kit";
import type { PrismaClient, ThreadEvents } from "@labradoodle/db";
import { runAsSystem, runAsTenant } from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import type { CloudAgentConnection } from "./cloud-agent-factory.js";
import { pollCloudAgent } from "./cloud-agent-poll.js";
import { expireComputerControl, scheduleComputerControlExpiry } from "./computer-control.js";
import { rateLimitEnds, scheduleComputerSleep, sleepComputerIfIdle } from "./computer-idle.js";
import { performComputerUpdate } from "./computer-update.js";
import type { createRunExecutor } from "./executor.js";
import type { ExpoPushProvider } from "./expo-push.js";
import { compactHistory } from "./history-compaction.js";
import { pollMediaVideo } from "./media-video-poll.js";
import type { MemoryProviderResolver } from "./memory-provider-factory.js";
import { pollPurchase } from "./purchase-poll.js";
import { expireTaughtSkillTeaching } from "./teaching-session.js";

type Tenant = { spaceId: string; userId: string };

/**
 * A job that acts for one run, routine, computer, skill, thread, cloud agent or purchase runs
 * as that row's tenant, so row-level security keeps it, and every tool it runs, in
 * the owner's Space even where a query forgets to filter. The owner comes from one
 * narrow system read; when the row is gone there is nothing left to act on.
 */
function asOwner<Key, P extends Key>(
  owner: (payload: Key) => Promise<Tenant | null>,
  handler: (payload: P, execution?: BackgroundJobExecution) => Promise<void>,
): (payload: P, execution?: BackgroundJobExecution) => Promise<void> {
  return async (payload, execution) => {
    const tenant = await runAsSystem("find the tenant a background job acts for", () =>
      owner(payload),
    );
    if (tenant) await runAsTenant(tenant, () => handler(payload, execution));
  };
}

const OWNER = { spaceId: true, userId: true } as const;
const CONTROL_EXPIRE_RETRY_MS = 30_000;

export function createBackgroundJobHandlers(deps: {
  executor: ReturnType<typeof createRunExecutor>;
  prisma: PrismaClient;
  sandbox: SandboxProvider;
  home: AgentHomeStore;
  artifacts: ArtifactStore;
  jobs: JobPublisher;
  events: ThreadEvents;
  workerId: string;
  runtime: AgentRuntime;
  secretStore: SecretStore;
  memoryProviders: MemoryProviderResolver;
  deploymentModelKey?: string;
  deploymentModelConfigured?: boolean;
  cloudAgent?: CloudAgentConnection | null;
  paymentWallet?: PaymentWalletProvider | null;
  notifications?: ExpoPushProvider;
  mediaGeneration?: MediaGenerationProvider;
  maxUploadSizeBytes?: number;
}): BackgroundJobHandlers {
  const run = ({ runId }: { runId: string }) =>
    deps.prisma.run.findUnique({ where: { id: runId }, select: OWNER });
  const routine = ({ routineId }: { routineId: string }) =>
    deps.prisma.routine.findUnique({ where: { id: routineId }, select: OWNER });
  const computer = ({ computerId }: { computerId: string }) =>
    deps.prisma.computer.findUnique({ where: { id: computerId }, select: OWNER });
  // A chat's work acts for the person whose turn asked for it, who can see the chat; its
  // creator may have left it.
  const thread = async ({ threadId, userId }: { threadId: string; userId?: string }) => {
    const row = await deps.prisma.thread.findUnique({ where: { id: threadId }, select: OWNER });
    return row && { spaceId: row.spaceId, userId: userId ?? row.userId };
  };
  const skill = ({ skillId }: { skillId: string }) =>
    deps.prisma.taughtSkill.findUnique({ where: { id: skillId }, select: OWNER });
  const cloudAgent = ({ agentId }: { agentId: string }) =>
    deps.prisma.cloudAgent.findUnique({ where: { id: agentId }, select: OWNER });
  const purchase = ({ purchaseId }: { purchaseId: string }) =>
    deps.prisma.purchase.findUnique({ where: { id: purchaseId }, select: OWNER });
  const mediaJob = async ({ jobId }: { jobId: string }) =>
    (
      await deps.prisma.externalEffect.findUnique({
        where: { id: jobId },
        select: { run: { select: OWNER } },
      })
    )?.run ?? null;
  const updatedComputer = async ({ updateId }: { updateId: string }) =>
    (
      await deps.prisma.computerUpdate.findUnique({
        where: { id: updateId },
        select: { computer: { select: OWNER } },
      })
    )?.computer ?? null;

  return {
    "run.continue": asOwner(run, async (payload, execution) => {
      if (execution)
        await deps.executor.continueRun(payload.runId, deps.workerId, execution.onRunStarted);
      else await deps.executor.continueRun(payload.runId, deps.workerId);
    }),
    "routine.wakeup": asOwner(routine, async (payload) => {
      await deps.executor.wakeRoutine(payload.routineId, payload.scheduledFor);
    }),
    "routine.retry": asOwner(run, async (payload) => {
      await deps.executor.retryRoutineRun(payload.runId);
    }),
    "computer.update": asOwner(updatedComputer, async ({ updateId }) => {
      await performComputerUpdate(deps, updateId);
    }),
    "computer.sleep": asOwner(computer, async (payload) => {
      await sleepComputerIfIdle(deps, payload.computerId);
    }),
    "computer.control-expire": asOwner(computer, async ({ computerId, leaseId }) => {
      try {
        if (await expireComputerControl(deps, computerId, leaseId)) {
          scheduleComputerSleep(deps.jobs, computerId);
        }
      } catch (error) {
        // Input is already denied and the lease kept, so a provider outage only delays the release.
        if (
          !(error instanceof SandboxUnresponsiveError) &&
          !(error instanceof SandboxUnavailableError) &&
          !(error instanceof SandboxRateLimitError)
        )
          throw error;
        getLogger().warn("computer.control_expire_deferred", { "computer.id": computerId, error });
        await scheduleComputerControlExpiry(
          deps.jobs,
          computerId,
          leaseId,
          rateLimitEnds(error) ?? new Date(Date.now() + CONTROL_EXPIRE_RETRY_MS),
        );
      }
    }),
    "skill.teaching-expire": asOwner(skill, async (payload) => {
      await expireTaughtSkillTeaching(deps, payload.skillId);
    }),
    "cloud_agent.poll": asOwner(cloudAgent, async (payload) => {
      await pollCloudAgent(
        { prisma: deps.prisma, jobs: deps.jobs, events: deps.events, cloudAgent: deps.cloudAgent },
        payload,
      );
    }),
    "purchase.poll": asOwner(purchase, async (payload) => {
      await pollPurchase(
        {
          prisma: deps.prisma,
          secretStore: deps.secretStore,
          jobs: deps.jobs,
          paymentWallet: deps.paymentWallet,
        },
        payload,
      );
    }),
    "media.poll": asOwner(mediaJob, async (payload) => {
      await pollMediaVideo(deps, payload);
    }),
    // A receipt belongs to a device's push token, not to a Space.
    "push.receipt": async (payload) => {
      await runAsSystem("check a push receipt", () => deps.notifications?.checkReceipt(payload));
    },
    "history.compact": asOwner(thread, async (payload) => {
      // Retrieval policies use stored context without paid message-count compaction.
      // Skip legacy backlog work after a policy change.
      if (deps.executor.contextStrategy && deps.executor.contextStrategy !== "current") return;
      await compactHistory(
        {
          prisma: deps.prisma,
          runtime: deps.runtime,
          jobs: deps.jobs,
          memoryProviders: deps.memoryProviders,
          deploymentModelKey: deps.deploymentModelKey,
          deploymentModelConfigured: deps.deploymentModelConfigured,
          ...(deps.executor.resolveModel ? { resolveModel: deps.executor.resolveModel } : {}),
        },
        payload.threadId,
        payload.userId,
      );
    }),
  };
}
