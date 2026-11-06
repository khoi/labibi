import { randomUUID } from "node:crypto";
import type { Actor } from "@labradoodle/contracts";
import { MODEL_REQUIRED_SEND_ERROR } from "@labradoodle/core";
import type { PrismaClient } from "@labradoodle/db";
import {
  asSystem,
  createDb,
  createThreadEvents,
  createThreadMessage,
  provisionTestBot,
  runAsSystem,
} from "@labradoodle/db";
import { RPCHandler } from "@orpc/server/fetch";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const databaseUrl = process.env.DATABASE_URL;
const enabled = process.env.VERIFY_DATABASE === "1" && Boolean(databaseUrl);

describe.skipIf(!enabled)("send model gate with a bot's own model (PostgreSQL)", () => {
  let prisma: PrismaClient;
  let system: PrismaClient;
  let close: () => Promise<void>;
  let actor: Actor;
  let botId: string;
  let call: (path: string, input: Record<string, unknown>) => Promise<Response>;
  const enqueue = vi.fn().mockResolvedValue(undefined);

  beforeAll(() => {
    const db = createDb(databaseUrl!);
    prisma = db.prisma;
    system = asSystem(prisma);
    close = async () => {
      await prisma.$disconnect();
      await db.pool.end();
    };
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    const identity = await runAsSystem("test fixture", () =>
      provisionTestBot(
        prisma,
        { address: `model-gate-${randomUUID()}` },
        { signupsEnabled: undefined, signupAllowlist: undefined },
      ),
    );
    botId = identity.botId;
    actor = { spaceId: identity.spaceId, userId: identity.userId } as Actor;
    // A working connection, but no main model and no deployment model.
    await system.userModelCredential.create({
      data: { userId: actor.userId, provider: "openrouter", label: "Key", secretId: "fixture" },
    });
    const deps = {
      prisma,
      events: createThreadEvents(prisma),
      jobs: { enqueue, cancel: vi.fn(), close: async () => undefined },
      secrets: { load: vi.fn() },
      sandbox: {},
      env: { agentRuntime: "pi", deploymentModelConfigured: false },
    } as unknown as RouterDeps;
    const handler = new RPCHandler(createRouter(deps));
    call = async (path, input) => {
      const { response } = await handler.handle(
        new Request(`http://127.0.0.1/rpc/threads/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
      return response!;
    };
  });
  afterEach(async () => {
    if (!actor) return;
    await system.organization.deleteMany({ where: { id: actor.spaceId } });
    await system.user.deleteMany({ where: { id: actor.userId } });
  });
  afterAll(async () => {
    await close?.();
  });

  const send = (input: Record<string, unknown>) => call("send", input);
  const useModel = (id: string, modelProvider: string | null) =>
    system.bot.update({
      where: { id },
      data: { modelProvider, modelId: modelProvider ? "openai/gpt-4o" : null },
    });
  const expectRefused = async (response: Response) => {
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      json: { message: MODEL_REQUIRED_SEND_ERROR },
    });
  };
  const userMessages = (threadId: string) =>
    system.message.count({ where: { threadId, role: "user" } });
  /** Reacts 👍 to a fresh reply from `author` and returns the runs the reaction started. */
  const react = async (target: Record<string, string>, threadId: string, author: string) => {
    await system.run.updateMany({ where: { threadId }, data: { status: "completed" } });
    const reply = await createThreadMessage(system, {
      threadId,
      role: "bot",
      botId: author,
      blocks: [{ kind: "text", text: "Done." }],
    });
    const response = await call("react", {
      ...target,
      messageId: reply.id,
      reaction: "👍",
      clientNonce: randomUUID(),
    });
    expect(response.status).toBe(200);
    const { runId } = ((await response.json()) as { json: { runId?: string } }).json;
    return runId ? [runId] : [];
  };

  it("starts a bot's turn on its own connected model, and refuses one without it", async () => {
    const thread = await system.thread.findFirstOrThrow({ where: { spaceId: actor.spaceId } });
    // A bot that follows the main model is still refused.
    await expectRefused(await send({ threadId: thread.id, text: "follows main" }));

    await useModel(botId, "openrouter");
    const accepted = await send({ threadId: thread.id, text: "own model" });
    expect(accepted.status).toBe(200);
    expect(enqueue).toHaveBeenCalled();
    expect(await userMessages(thread.id)).toBe(1);
    // A reaction to its reply starts a turn too.
    expect(await react({ threadId: thread.id }, thread.id, botId)).toHaveLength(1);

    // A provider without a model follows the main model.
    await system.bot.update({ where: { id: botId }, data: { modelId: null } });
    await expectRefused(await send({ threadId: thread.id, text: "no model id" }));
    expect(await react({ threadId: thread.id }, thread.id, botId)).toEqual([]);
    // Its model is set, but no connection serves that provider.
    await useModel(botId, "anthropic");
    await expectRefused(await send({ threadId: thread.id, text: "no connection" }));
    // The connection is gone.
    await useModel(botId, "openrouter");
    await system.userModelCredential.deleteMany({ where: { userId: actor.userId } });
    await expectRefused(await send({ threadId: thread.id, text: "disconnected" }));
    // The accepted send and the two reactions; no refused send was saved.
    expect(await userMessages(thread.id)).toBe(3);
  });

  it("lets a bare stop end active work without a model, and refuses it when idle", async () => {
    const thread = await system.thread.findFirstOrThrow({ where: { spaceId: actor.spaceId } });
    await expectRefused(await send({ threadId: thread.id, text: "stop" }));
    const work = { spaceId: actor.spaceId, botId, threadId: thread.id, userId: actor.userId };
    const task = await system.task.create({ data: { ...work, prompt: "work", status: "queued" } });
    const run = await system.run.create({
      data: { ...work, taskId: task.id, status: "running", trigger: "user" },
    });
    await expectRefused(await send({ threadId: thread.id, text: "stop please" }));
    expect((await send({ threadId: thread.id, text: "Stop now" })).status).toBe(200);
    expect((await system.run.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      "cancelled",
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(await userMessages(thread.id)).toBe(1);
  });
});
