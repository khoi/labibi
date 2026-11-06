import type { UsageOperationKind } from "@labradoodle/adapter-kit";
import { attachmentMaxBytes } from "@labradoodle/contracts";
import { AttachmentValidationError } from "@labradoodle/core";
import { LISTED_ARTIFACT, requireChatMember } from "@labradoodle/db";
import { ORPCError } from "@orpc/server";
import {
  ArtifactListCursorError,
  createOwnedArtifact,
  deleteArtifactFamily,
  getOwnedArtifact,
  getSpaceArtifactById,
  listArtifactVersions,
  listSpaceArtifacts,
} from "../artifacts.js";
import { requireIdentityConfirmation } from "../identity-confirmation.js";
import { listSpaceRuns } from "../runs.js";
import { querySpaceSearch } from "../search.js";
import type { RouterContext } from "./context.js";

export function contentRoutes(ctx: RouterContext) {
  const { deps, favicons, authed } = ctx;
  return {
    artifacts: {
      list: authed.artifacts.list.handler(async ({ context, input }) => {
        await requireChatMember(deps.prisma, context.actor, input.threadId);
        const rows = await deps.prisma.artifact.findMany({
          where: {
            threadId: input.threadId,
            spaceId: context.actor.spaceId,
            ...LISTED_ARTIFACT,
          },
        });
        return rows.map((row) => ({
          id: row.id,
          threadId: row.threadId,
          runId: row.runId,
          name: row.name,
          description: row.description,
          mimeType: row.mimeType,
          size: row.size,
          version: row.version,
          createdAt: row.createdAt.toISOString(),
        }));
      }),
      listSpace: authed.artifacts.listSpace.handler(async ({ context, input }) => {
        if (input.threadId) await requireChatMember(deps.prisma, context.actor, input.threadId);
        try {
          return await listSpaceArtifacts(deps, context.actor, input);
        } catch (error) {
          if (error instanceof ArtifactListCursorError) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw error;
        }
      }),
      listVersions: authed.artifacts.listVersions.handler(async ({ context, input }) => {
        return listArtifactVersions(deps, context.actor, input);
      }),
      create: authed.artifacts.create.handler(async ({ context, input }) => {
        await requireChatMember(deps.prisma, context.actor, input.threadId);
        try {
          return await createOwnedArtifact(
            { ...deps, maxUploadSizeBytes: attachmentMaxBytes(deps.env) },
            context.actor,
            input,
          );
        } catch (error) {
          if (error instanceof AttachmentValidationError) {
            throw new ORPCError("BAD_REQUEST", { message: error.message });
          }
          throw error;
        }
      }),
      get: authed.artifacts.get.handler(async ({ context, input }) => {
        await requireChatMember(deps.prisma, context.actor, input.threadId);
        return getOwnedArtifact(deps, context.actor, input);
      }),
      getById: authed.artifacts.getById.handler(async ({ context, input }) => {
        return getSpaceArtifactById(deps, context.actor, input);
      }),
      remove: authed.artifacts.remove.handler(async ({ context, input }) => {
        return deleteArtifactFamily(deps, context.actor, { familyId: input.artifactId });
      }),
    },
    usage: {
      list: authed.usage.list.handler(async ({ context }) => {
        const rows = await deps.prisma.usageRecord.findMany({
          where: { spaceId: context.actor.spaceId, userId: context.actor.userId },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        return rows.map((row) => ({
          id: row.id,
          botId: row.botId,
          runId: row.runId,
          provider: row.provider,
          model: row.model,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          cacheReadTokens: row.cacheReadTokens,
          cacheWriteTokens: row.cacheWriteTokens,
          cacheWrite1hTokens: row.cacheWrite1hTokens,
          reasoningTokens: row.reasoningTokens,
          totalTokens: row.totalTokens,
          costUsd: row.costUsd,
          costSource: row.costSource,
          pricingVersion: row.pricingVersion,
          usageSource: row.usageSource,
          callId: row.callId,
          operationId: row.operationId,
          operationKind: row.operationKind as UsageOperationKind,
          parentRunId: row.parentRunId,
          agentId: row.agentId,
          createdAt: row.createdAt.toISOString(),
        }));
      }),
      summary: authed.usage.summary.handler(async ({ context }) => {
        const where = { spaceId: context.actor.spaceId, userId: context.actor.userId };
        const sums = {
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          costUsd: true,
        } as const;
        const counts = { _all: true, ...sums } as const;
        const [result, modelGroups, runGroups] = await Promise.all([
          deps.prisma.usageRecord.aggregate({ where, _sum: sums, _count: counts }),
          deps.prisma.usageRecord.groupBy({
            by: ["provider", "model"],
            where,
            _sum: sums,
            _count: counts,
          }),
          deps.prisma.usageRecord.groupBy({ by: ["runId", "parentRunId"], where }),
        ]);
        const runs = new Set(runGroups.map((row) => row.parentRunId ?? row.runId).filter(Boolean))
          .size;
        // A total that skips rows without a count would understate spend, so it reads as unknown.
        const completeSums = (group: {
          _sum: Record<keyof typeof sums, number | null>;
          _count: Record<keyof typeof counts, number>;
        }) => {
          const complete = (field: keyof typeof sums) =>
            group._count[field] === group._count._all ? (group._sum[field] ?? 0) : null;
          return {
            inputTokens: complete("inputTokens"),
            outputTokens: complete("outputTokens"),
            totalTokens: complete("totalTokens"),
            costUsd: complete("costUsd"),
            modelCalls: group._count._all,
          };
        };
        return {
          ...completeSums(result),
          runs,
          models: modelGroups
            .map((group) => ({
              provider: group.provider,
              model: group.model,
              ...completeSums(group),
            }))
            .sort(
              (a, b) => (b.totalTokens ?? 0) - (a.totalTokens ?? 0) || b.modelCalls - a.modelCalls,
            ),
        };
      }),
    },
    export: {
      accountToken: authed.export.accountToken.handler(async ({ context }) => {
        await requireIdentityConfirmation(deps.auth, context);
        return { token: await deps.auth.issueAccountExportToken(context.actor.userId) };
      }),
    },
    search: {
      query: authed.search.query.handler(async ({ context, input }) => ({
        hits: await querySpaceSearch(deps.prisma, context.actor, input.q),
      })),
    },
    links: {
      favicon: authed.links.favicon.handler(async ({ input }) => favicons.favicon(input.origin)),
    },
    runs: {
      list: authed.runs.list.handler(async ({ context, input }) => ({
        runs: await listSpaceRuns(deps.prisma, context.actor, input.filter),
      })),
    },
  };
}
