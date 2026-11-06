import type { MemoryScope } from "@labradoodle/adapter-kit";
import { MEMORY_REVISION_CONFLICT_ERROR } from "@labradoodle/adapter-kit";
import { buildAgentMemoryPrompt, readAgentMemory } from "@labradoodle/adapters";
import type { Actor } from "@labradoodle/contracts";
import { isDeletableMemoryDocument } from "@labradoodle/contracts";
import { findSpaceMemoryConfig, IsolationError, requireChatMember } from "@labradoodle/db";
import { ORPCError } from "@orpc/server";
import {
  disconnectMemoryProvider,
  persistMemoryProviderConfig,
  serializeSpaceMemoryConfig,
} from "../memory-provider-config.js";
import { resolveChatTarget } from "../thread-target.js";
import type { RouterContext } from "./context.js";

/** A chat's memory with `threadId`, else the caller's own in this workspace. */
function memoryWhere(actor: Actor, threadId?: string) {
  return threadId
    ? { spaceId: actor.spaceId, threadId }
    : { spaceId: actor.spaceId, threadId: null, userId: actor.userId };
}

function memoryScopeOf(doc: { threadId: string | null; userId: string }): MemoryScope {
  return doc.threadId
    ? { kind: "chat", threadId: doc.threadId }
    : { kind: "person", userId: doc.userId };
}

function memoryDocumentDto(doc: {
  id: string;
  threadId: string | null;
  path: string;
  content: string;
  revision: number;
  updatedAt: Date;
}) {
  return {
    id: doc.id,
    threadId: doc.threadId,
    path: doc.path,
    content: doc.content,
    revision: doc.revision,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function memoryContext(actor: Actor, botId: string, signal?: AbortSignal) {
  return {
    operationId: "mem",
    traceId: "mem",
    spaceId: actor.spaceId,
    userId: actor.userId,
    botId,
    signal: signal ?? new AbortController().signal,
  };
}

export function memoryRoutes(ctx: RouterContext) {
  const { deps, taughtSkills, agentSkills, authed } = ctx;
  return {
    memory: {
      list: authed.memory.list.handler(async ({ context, input }) => {
        if (input.threadId) {
          await requireChatMember(deps.prisma, context.actor, input.threadId);
        }
        const docs = await deps.prisma.memoryDocument.findMany({
          where: memoryWhere(context.actor, input.threadId),
          orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
        });
        return docs.map(memoryDocumentDto);
      }),
      budget: authed.memory.budget.handler(async ({ context, input }) => {
        const target = await resolveChatTarget(deps.prisma, context.actor, input);
        // Read through the store a run uses, so the numbers match what Doodle receives.
        const documents = await readAgentMemory(
          deps.memory,
          {
            threadId: target.threadId,
            ...(target.people <= 1 ? { personUserId: context.actor.userId } : {}),
          },
          memoryContext(context.actor, target.doodleId, context.signal),
        );
        return buildAgentMemoryPrompt(documents).plan;
      }),
      update: authed.memory.update.handler(async ({ context, input }) => {
        // Row-level security shows only the caller's chats' memory and their own.
        const doc = await deps.prisma.memoryDocument.findFirst({
          where: { id: input.documentId, spaceId: context.actor.spaceId },
        });
        if (!doc) throw new IsolationError();
        const updated = await deps.memory
          .commit(
            {
              scope: memoryScopeOf(doc),
              path: doc.path,
              content: input.content,
              expectedRevision: input.expectedRevision,
            },
            memoryContext(context.actor, doc.threadId ?? "person"),
          )
          .catch((error: unknown) => {
            if (error instanceof Error && error.message === MEMORY_REVISION_CONFLICT_ERROR) {
              throw new ORPCError("CONFLICT", { message: error.message });
            }
            throw error;
          });
        return {
          id: updated.id,
          threadId: doc.threadId,
          path: updated.path,
          content: updated.content,
          revision: updated.revision,
          updatedAt: new Date().toISOString(),
        };
      }),
      remove: authed.memory.remove.handler(async ({ context, input }) => {
        const doc = await deps.prisma.memoryDocument.findFirst({
          where: { id: input.documentId, spaceId: context.actor.spaceId },
        });
        if (!doc) throw new IsolationError();
        if (!isDeletableMemoryDocument(doc.path)) {
          throw new ORPCError("BAD_REQUEST", {
            message: `${doc.path} cannot be deleted; edit its content instead.`,
          });
        }
        await deps.memory.remove(
          { id: doc.id, scope: memoryScopeOf(doc), path: doc.path },
          memoryContext(context.actor, doc.threadId ?? "person"),
        );
        return { ok: true as const };
      }),
      exportMarkdown: authed.memory.exportMarkdown.handler(async ({ context, input }) => {
        if (input.threadId) {
          await requireChatMember(deps.prisma, context.actor, input.threadId);
        }
        const docs = await deps.prisma.memoryDocument.findMany({
          where: memoryWhere(context.actor, input.threadId),
          orderBy: { path: "asc" },
        });
        return docs.map((d) => `# ${d.path}\n\n${d.content}`).join("\n\n");
      }),
      providerConfig: authed.memory.providerConfig.handler(async ({ context }) => {
        const config = await findSpaceMemoryConfig(deps.prisma, context.actor.spaceId);
        return config ? serializeSpaceMemoryConfig(config) : null;
      }),
      connectProvider: authed.memory.connectProvider.handler(async ({ context, input }) =>
        persistMemoryProviderConfig(deps, context.actor, input),
      ),
      disconnectProvider: authed.memory.disconnectProvider.handler(async ({ context }) =>
        disconnectMemoryProvider(deps, context.actor),
      ),
    },
    skills: {
      list: authed.skills.list.handler(async ({ context }) => taughtSkills.list(context.actor)),
      get: authed.skills.get.handler(async ({ context, input }) =>
        taughtSkills.get(context.actor, input.skillId),
      ),
      start: authed.skills.start.handler(async ({ context, input }) =>
        taughtSkills.start(context.actor, input.goal),
      ),
      appendEvent: authed.skills.appendEvent.handler(async ({ context, input }) =>
        taughtSkills.appendEvent(context.actor, input.skillId, input.event),
      ),
      snapshot: authed.skills.snapshot.handler(async ({ context, input }) =>
        taughtSkills.snapshot(context.actor, input.skillId),
      ),
      stop: authed.skills.stop.handler(async ({ context, input }) =>
        taughtSkills.stop(context.actor, input.skillId),
      ),
      updateDraft: authed.skills.updateDraft.handler(async ({ context, input }) =>
        taughtSkills.updateDraft(context.actor, input.skillId, {
          name: input.name,
          playbook: input.playbook,
        }),
      ),
      save: authed.skills.save.handler(async ({ context, input }) =>
        taughtSkills.save(context.actor, input.skillId, input.name),
      ),
      testRun: authed.skills.testRun.handler(async ({ context, input }) =>
        taughtSkills.testRun(context.actor, input.skillId, input.prompt),
      ),
      remove: authed.skills.remove.handler(async ({ context, input }) =>
        taughtSkills.remove(context.actor, input.skillId),
      ),
    },
    agentSkills: {
      list: authed.agentSkills.list.handler(async ({ context }) => agentSkills.list(context.actor)),
      get: authed.agentSkills.get.handler(async ({ context, input }) =>
        agentSkills.get(context.actor, input),
      ),
      create: authed.agentSkills.create.handler(async ({ context, input }) =>
        agentSkills.create(context.actor, input),
      ),
      update: authed.agentSkills.update.handler(async ({ context, input }) =>
        agentSkills.update(context.actor, input),
      ),
      remove: authed.agentSkills.remove.handler(async ({ context, input }) =>
        agentSkills.remove(context.actor, input.skillId),
      ),
    },
  };
}
