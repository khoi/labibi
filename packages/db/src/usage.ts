import type { AgentRuntimeEvent, UsageOperationKind } from "@labradoodle/adapter-kit";
import type { PrismaClient } from "./generated/prisma/client.js";

type UsageEvent = Extract<AgentRuntimeEvent, { type: "usage" }>;
export interface UsageAttribution {
  spaceId: string;
  userId: string;
  botId?: string;
  runId?: string;
  parentRunId?: string;
  operationId?: string;
  operationKind?: UsageOperationKind;
}

/** Usage is history, independent from message clearing or bot deletion. */
export async function recordUsage(
  prisma: Pick<PrismaClient, "usageRecord">,
  event: UsageEvent,
  attribution: UsageAttribution,
) {
  await prisma.usageRecord.createMany({
    data: [
      {
        provider: event.provider,
        model: event.model,
        spaceId: attribution.spaceId,
        userId: attribution.userId,
        botId: attribution.botId,
        runId: attribution.runId,
        operationId: attribution.operationId,
        parentRunId: attribution.parentRunId ?? attribution.runId,
        providerRequestId: event.providerRequestId ?? null,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens ?? null,
        cacheWriteTokens: event.cacheWriteTokens ?? null,
        cacheWrite1hTokens: event.cacheWrite1hTokens ?? null,
        reasoningTokens: event.reasoningTokens ?? null,
        totalTokens: event.totalTokens ?? null,
        costUsd: event.costUsd ?? null,
        costSource: event.costSource ?? null,
        pricingVersion: event.pricingVersion ?? null,
        pricingSnapshot: event.pricingSnapshot
          ? JSON.parse(JSON.stringify(event.pricingSnapshot))
          : undefined,
        usageSource: event.usageSource ?? null,
        callId: event.callId ?? null,
        operationKind: attribution.operationKind ?? event.operationKind ?? "answer",
        agentId: event.agentId ?? null,
      },
    ],
    skipDuplicates: true,
  });
}
