import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ComposioConnector,
  createScheduleFromTool,
  DesktopSandboxProvider,
  DestinationEmulator,
  FakeComposioClient,
  FakeSandboxProvider,
  listPiCatalog,
  toComputerRef,
} from "@labradoodle/adapters";
import type { createApp } from "@labradoodle/api/app";
import {
  ACTIVE_RUN_STATUSES,
  ONCE_ROUTINE_CRON,
  resolveScreenProxySecret,
} from "@labradoodle/core";
import { openScreenCapability } from "@labradoodle/core/node/screen-capability";
import {
  appendEvent,
  createThreadEvents,
  createThreadMessage,
  RunHistoryWriteError,
  runAsSystem,
} from "@labradoodle/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sessionCookieHeader } from "./index.js";
import { createModelConnectionFixtureFetch } from "./model-connection-fixture.js";
import { asSystem } from "./system-db.js";

type App = { request: (input: string, init?: RequestInit) => Response | Promise<Response> };
process.env.WAKEUP_DRIVER = "memory";
process.env.SANDBOX_PROVIDER = "fake";
process.env.AGENT_RUNTIME = "scripted";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeJourneys = hasDb ? describe : describe.skip;

describeJourneys("required product journeys", () => {
  let app: App;
  let stop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof createApp>>["prisma"];
  let appPrisma: Awaited<ReturnType<typeof createApp>>["prisma"];
  const connector = new DestinationEmulator();
  let executor: Awaited<ReturnType<typeof createApp>>["executor"];
  let jobs: Awaited<ReturnType<typeof createApp>>["jobs"];
  let sandbox: Awaited<ReturnType<typeof createApp>>["sandbox"];
  const stamp = Date.now();
  const dataDir = mkdtempSync(path.join(tmpdir(), "rakazo-journey-"));

  /** Runs every action without a card, for journeys about something other than approvals. */
  async function runWithoutAsking(cookie: string) {
    await rpc(app, cookie, "autoReview/set", { mode: "never" });
  }

  async function sendAndWait(app: App, cookie: string, botId: string, text: string) {
    const { runId } = await rpc<{ runId: string }>(app, cookie, "threads/send", { botId, text });
    let terminal = null as { status: string; error: string | null } | null;
    await waitForDatabase(async () => {
      terminal = await prisma.run.findUnique({
        where: { id: runId },
        select: { status: true, error: true },
      });
      return Boolean(terminal && ["completed", "failed", "cancelled"].includes(terminal.status));
    });
    if (!terminal) throw new Error(`run ${runId} was not found after completion`);
    if (terminal.status !== "completed") {
      throw new Error(
        `run ${runId} ended ${terminal.status}: ${terminal.error ?? "unknown error"}`,
      );
    }
    return {
      ...(await rpc<Snap>(app, cookie, "threads/get", { botId })),
      run: { id: runId, status: terminal.status },
    };
  }

  beforeAll(async () => {
    const { createApp } = await import("@labradoodle/api/app");
    const handles = await createApp({
      modelConnectionFetch: createModelConnectionFixtureFetch(listPiCatalog()),
      databaseUrl: process.env.DATABASE_URL!,
      dataDir,
      sandboxProvider: "fake",
      agentRuntime: "scripted",
      composio: new ComposioConnector({ client: new FakeComposioClient() }),
      connectors: [connector],
    });
    app = handles.app;
    stop = handles.stop;
    prisma = asSystem(handles.prisma);
    appPrisma = handles.prisma;
    executor = handles.executor;
    jobs = handles.jobs;
    sandbox = handles.sandbox;
  });

  afterAll(async () => {
    await stop?.();
  });

  it("computer updates preserve the workspace and reserve the shared computer until completion", async () => {
    const cookie = await signup(app, `maintenance-${stamp}@rakazo.test`, "Maintenance");
    const outsider = await signup(app, `maintenance-other-${stamp}@rakazo.test`, "Other workspace");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Writer",
      title: "Writer",
      instructions: "Write files.",
    });
    await waitForDatabase(
      async () =>
        (await prisma.run.count({
          where: { botId: bot.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
        })) === 0,
    );
    await rpc(app, cookie, "computer/boot", { botId: bot.id });
    const original = await prisma.bot.findUniqueOrThrow({
      where: { id: bot.id },
      include: { computer: true },
    });
    const ctx = {
      operationId: "fixture",
      traceId: "fixture",
      spaceId: original.spaceId,
      userId: original.userId,
      botId: bot.id,
      signal: new AbortController().signal,
    };
    await sandbox.writeFile(
      toComputerRef(original.computer!),
      { path: "notes.txt", content: new TextEncoder().encode("durable work") },
      ctx,
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const destroyed = vi.spyOn(sandbox, "destroy");
    const exportWorkspace = sandbox.exportWorkspace.bind(sandbox);
    const spy = vi
      .spyOn(sandbox, "exportWorkspace")
      .mockImplementation(async function* (ref, context) {
        await gate;
        yield* exportWorkspace(ref, context);
      });
    try {
      const update = await rpc<{ id: string }>(app, cookie, "computer/update", { botId: bot.id });
      await waitForDatabase(
        async () =>
          (await prisma.computerUpdate.findUniqueOrThrow({ where: { id: update.id } })).stage ===
          "saving",
      );
      expect(await rpc(app, outsider, "computer/updates")).toEqual([]);
      const duplicate = await app.request("/rpc/computer/update", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ json: { botId: bot.id } }),
      });
      expect(duplicate.status).toBe(409);
      const stopped = await app.request("/rpc/computer/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ json: { botId: bot.id } }),
      });
      expect(stopped.status).toBe(409);
      const switched = await app.request("/rpc/bots/setComputer", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ json: { botId: bot.id, mode: "dedicated" } }),
      });
      expect(switched.status).toBe(409);
      release();
      await waitForDatabase(
        async () =>
          (await prisma.computerUpdate.findUniqueOrThrow({ where: { id: update.id } })).status ===
          "completed",
      );
      const replacement = await prisma.computer.findUniqueOrThrow({
        where: { id: original.computerId! },
      });
      expect(replacement.maintenanceId).toBeNull();
      expect(destroyed).toHaveBeenCalledWith(
        expect.objectContaining({ providerRef: original.computer!.providerRef }),
        expect.anything(),
      );
      expect(
        new TextDecoder().decode(
          await sandbox.readFile(toComputerRef(replacement), "notes.txt", ctx),
        ),
      ).toBe("durable work");
    } finally {
      release();
      spy.mockRestore();
      destroyed.mockRestore();
    }
  });

  it("updating a computer the user has taken over hands control back first", async () => {
    const cookie = await signup(app, `maintenance-control-${stamp}@rakazo.test`, "Maintenance");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Shell user",
      title: "Shell user",
      instructions: "Help.",
    });
    await waitForDatabase(
      async () =>
        (await prisma.run.count({
          where: { botId: bot.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
        })) === 0,
    );
    await rpc(app, cookie, "computer/boot", { botId: bot.id });
    // Opening the Shell tab holds a user takeover with no run waiting on it.
    await rpc(app, cookie, "computer/takeover", { botId: bot.id });
    const update = await rpc<{ id: string }>(app, cookie, "computer/update", { botId: bot.id });
    await waitForDatabase(
      async () =>
        (await prisma.computerUpdate.findUniqueOrThrow({ where: { id: update.id } })).status ===
        "completed",
    );
    const computer = await prisma.computer.findFirstOrThrow({
      where: { bots: { some: { id: bot.id } } },
    });
    expect(computer.controlHolder).not.toBe("user");
    expect(computer.controlLeaseId).toBeNull();
  });

  it("recovering a computer the user has taken over hands control back first", async () => {
    const cookie = await signup(app, `maintenance-recover-${stamp}@rakazo.test`, "Maintenance");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Shell user",
      title: "Shell user",
      instructions: "Help.",
    });
    await waitForDatabase(
      async () =>
        (await prisma.run.count({
          where: { botId: bot.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
        })) === 0,
    );
    await rpc(app, cookie, "computer/boot", { botId: bot.id });
    await rpc(app, cookie, "computer/takeover", { botId: bot.id });
    const update = await rpc<{ id: string }>(app, cookie, "computer/recover", { botId: bot.id });
    await waitForDatabase(
      async () =>
        (await prisma.computerUpdate.findUniqueOrThrow({ where: { id: update.id } })).status ===
        "completed",
    );
    const computer = await prisma.computer.findFirstOrThrow({
      where: { bots: { some: { id: bot.id } } },
    });
    expect(computer.controlHolder).not.toBe("user");
    expect(computer.controlLeaseId).toBeNull();
  });

  it("resetting a computer the user has taken over hands control back first", async () => {
    const cookie = await signup(app, `maintenance-reset-${stamp}@rakazo.test`, "Maintenance");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Shell user",
      title: "Shell user",
      instructions: "Help.",
    });
    await waitForDatabase(
      async () =>
        (await prisma.run.count({
          where: { botId: bot.id, status: { in: [...ACTIVE_RUN_STATUSES] } },
        })) === 0,
    );
    await rpc(app, cookie, "computer/boot", { botId: bot.id });
    await rpc(app, cookie, "computer/takeover", { botId: bot.id });
    await rpc(app, cookie, "computer/reset", { botId: bot.id });
    const computer = await prisma.computer.findFirstOrThrow({
      where: { bots: { some: { id: bot.id } } },
    });
    expect(computer.controlHolder).not.toBe("user");
    expect(computer.controlLeaseId).toBeNull();
  });

  it("maintenance leaves a run waiting on control", async () => {
    const cookie = await signup(app, `maintenance-waiting-${stamp}@rakazo.test`, "Maintenance");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    await rpc(app, cookie, "threads/send", {
      botId: bot.id,
      text: "install the gsc cli and sign in",
    });
    const waiting = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => snap.run?.status === "waiting_takeover",
    );
    await rpc(app, cookie, "computer/boot", { botId: bot.id });
    await rpc(app, cookie, "computer/takeover", { botId: bot.id });
    const runId = waiting.run?.id;
    if (!runId) throw new Error("waiting run missing");
    await waitForDatabase(async () => {
      const computer = await prisma.computer.findFirstOrThrow({
        where: { bots: { some: { id: bot.id } } },
      });
      return computer.controlHolder === "user" && computer.controlRunId === runId;
    });

    for (const proc of ["computer/update", "computer/recover", "computer/reset"] as const) {
      const response = await raw(app, cookie, proc, { botId: bot.id });
      expect(response.status).toBe(409);
    }

    const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("waiting_takeover");
    const computer = await prisma.computer.findFirstOrThrow({
      where: { bots: { some: { id: bot.id } } },
    });
    expect(computer.controlHolder).toBe("user");
    expect(computer.controlLeaseId).not.toBeNull();
    expect(computer.controlRunId).toBe(runId);
    expect(
      await prisma.computerUpdate.count({
        where: { botId: bot.id, status: { in: ["queued", "running", "completed"] } },
      }),
    ).toBe(0);
  });

  it("1+2: users are isolated and workspace bots share the Team Computer", async () => {
    const ada = await signup(app, `ada-j-${stamp}@rakazo.test`, "Ada Journey");
    const bob = await signup(app, `bob-j-${stamp}@rakazo.test`, "Bob Journey");

    const adaMe = await rpc<Me>(app, ada, "me");
    const bobMe = await rpc<Me>(app, bob, "me");
    expect(adaMe.spaceId).not.toBe(bobMe.spaceId);

    const chief = await rpc<Bot>(app, ada, "bots/create", {
      name: "Chief",
      title: "Chief of staff",
      instructions: "",
      notifyOnFinish: true,
    });
    const coder = await rpc<Bot>(app, ada, "bots/create", {
      name: "Coder",
      title: "Engineer",
      instructions: "",
      notifyOnFinish: true,
    });
    const bobBot = await rpc<Bot>(app, bob, "bots/create", {
      name: "Chief",
      title: "Chief of staff",
      instructions: "",
      notifyOnFinish: true,
    });
    const [chiefRecord, coderRecord, bobRecord] = await Promise.all(
      [chief.id, coder.id, bobBot.id].map((id) =>
        prisma.bot.findUniqueOrThrow({ where: { id }, include: { computer: true } }),
      ),
    );
    expect(chief.computerMode).toBe("team");
    expect(coder.computerMode).toBe("team");
    expect(chiefRecord!.computerId).toBe(coderRecord!.computerId);
    expect(chiefRecord!.computerId).not.toBe(bobRecord!.computerId);

    const bobList = await rpc<Bot[]>(app, bob, "bots/list");
    expect(bobList.map((b) => b.id)).not.toContain(chief.id);
    const forbidden = await raw(app, bob, "bots/get", { botId: chief.id });
    expect(forbidden.status).toBeGreaterThanOrEqual(400);

    await sendAndWait(
      app,
      ada,
      chief.id,
      "write a file in your home called notes/result.txt that says isolation-ok",
    );
    expect(
      (await rpc<Bot[]>(app, ada, "bots/list")).find((bot) => bot.id === chief.id)?.unread,
    ).toBe(true);
    await rpc(app, ada, "threads/markRead", { botId: chief.id });
    expect(
      (await rpc<Bot[]>(app, ada, "bots/list")).find((bot) => bot.id === chief.id)?.unread,
    ).toBe(false);
    await rpc(app, ada, "threads/markUnread", { botId: chief.id });
    expect(
      (await rpc<Bot[]>(app, ada, "bots/list")).find((bot) => bot.id === chief.id)?.unread,
    ).toBe(true);
    await sendAndWait(app, ada, coder.id, "remember that coder prefers rust");

    const chiefFile = await rpc<{ path: string; content: string }>(app, ada, "computer/readFile", {
      botId: chief.id,
      path: "notes/result.txt",
    });
    expect(chiefFile.content).toContain("isolation-ok");
    const computer = await rpc<{ state: string }>(app, ada, "computer/status", { botId: chief.id });
    expect(computer.state).toBe("running");
    await rpc(app, ada, "computer/stop", { botId: chief.id });
    const persisted = await rpc<{ content: string }>(app, ada, "computer/readFile", {
      botId: chief.id,
      path: "notes/result.txt",
    });
    expect(persisted.content).toContain("isolation-ok");
    const coderMem = await rpc<Array<{ content: string }>>(app, ada, "memory/list", {
      botId: coder.id,
    });
    expect(coderMem.some((m) => m.content.toLowerCase().includes("rust"))).toBe(true);
    const dedicated = await rpc<Bot>(app, ada, "bots/setComputer", {
      botId: coder.id,
      mode: "dedicated",
    });
    expect(dedicated.computerMode).toBe("dedicated");
    const dedicatedRecord = await prisma.bot.findUniqueOrThrow({
      where: { id: coder.id },
      include: { computer: true },
    });
    expect(dedicatedRecord.computerId).not.toBe(chiefRecord!.computerId);
    await rpc<Bot>(app, ada, "bots/setComputer", { botId: coder.id, mode: "team" });
    const backOnTeam = await prisma.bot.findUniqueOrThrow({ where: { id: coder.id } });
    expect(backOnTeam.computerId).toBe(chiefRecord!.computerId);
    await rpc<Bot>(app, ada, "bots/setComputer", { botId: coder.id, mode: "dedicated" });
    const reusedDedicated = await prisma.bot.findUniqueOrThrow({ where: { id: coder.id } });
    expect(reusedDedicated.computerId).toBe(dedicatedRecord.computerId);
    expect(bobBot.id).not.toBe(chief.id);
  });

  it("guards memory edits by revision while preserving legacy clients", async () => {
    const cookie = await signup(app, `memory-revision-${stamp}@rakazo.test`, "Memory revisions");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Keeper",
      title: "Memory",
      instructions: "",
      notifyOnFinish: true,
    });
    const [doc] = await rpc<Array<{ id: string; revision: number }>>(app, cookie, "memory/list", {
      botId: bot.id,
    });
    if (!doc) throw new Error("Missing seeded memory");
    await rpc(app, cookie, "memory/update", { documentId: doc.id, content: "A\nB" });
    const revisionCount = await prisma.memoryRevision.count({ where: { documentId: doc.id } });
    const stale = await raw(app, cookie, "memory/update", {
      documentId: doc.id,
      content: "A'",
      expectedRevision: doc.revision,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ json: { code: "CONFLICT" } });
    expect(await prisma.memoryRevision.count({ where: { documentId: doc.id } })).toBe(
      revisionCount,
    );
    expect(await prisma.memoryDocument.findUniqueOrThrow({ where: { id: doc.id } })).toMatchObject({
      content: "A\nB",
      revision: doc.revision + 1,
    });
    expect(
      await rpc(app, cookie, "memory/update", {
        documentId: doc.id,
        content: "current",
        expectedRevision: doc.revision + 1,
      }),
    ).toMatchObject({ content: "current", revision: doc.revision + 2 });
    expect(
      await rpc(app, cookie, "memory/update", { documentId: doc.id, content: "legacy" }),
    ).toMatchObject({ content: "legacy", revision: doc.revision + 3 });
  });

  it("clears a conversation without removing the bot, computer, memory, or routines", async () => {
    const cookie = await signup(app, `clear-j-${stamp}@rakazo.test`, "Clear Journey");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Keeper",
      title: "Keeps its setup",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });
    await sendAndWait(
      app,
      cookie,
      bot.id,
      "write a file in your home called notes/result.txt that says kept-after-clear",
    );
    const memories = await rpc<Array<{ id: string }>>(app, cookie, "memory/list", {
      botId: bot.id,
    });
    await rpc(app, cookie, "memory/update", {
      documentId: memories[0]!.id,
      content: "# Keeper\n\nRemember this after clearing.",
    });
    const routine = await rpc<{ id: string }>(app, cookie, "routines/create", {
      botId: bot.id,
      name: "Kept routine",
      prompt: "Check in",
      crons: ["0 9 * * 1"],
      timezone: "UTC",
      notify: false,
      active: false,
    });
    const thread = await prisma.thread.findUniqueOrThrow({ where: { botId: bot.id } });
    const task = await prisma.task.create({
      data: {
        spaceId: thread.spaceId,
        userId: thread.userId,
        botId: bot.id,
        threadId: thread.id,
        prompt: "queued before clear",
        status: "queued",
      },
    });
    const run = await prisma.run.create({
      data: {
        spaceId: thread.spaceId,
        userId: thread.userId,
        botId: bot.id,
        threadId: thread.id,
        taskId: task.id,
        status: "queued",
        trigger: "user",
      },
    });
    await prisma.thread.update({
      where: { id: thread.id },
      data: {
        historyCompactedUpToSeq: 0,
        historyCompactionSummary: "summary that must be invalidated",
        historyCompactionGeneration: 3,
      },
    });

    await rpc(app, cookie, "threads/clear", { botId: bot.id });

    const snap = await rpc<Snap>(app, cookie, "threads/get", { botId: bot.id });
    expect(snap.messages).toEqual([]);
    expect(snap.run).toBeNull();
    expect(await prisma.message.count({ where: { threadId: thread.id } })).toBe(0);
    expect(await prisma.event.findMany({ where: { threadId: thread.id } })).toMatchObject([
      { type: "thread.cleared" },
    ]);
    // The deleted messages all count as compacted, so compaction cannot summarize them and
    // recall cannot treat the fresh conversation as having uncompacted history.
    const clearedThread = await prisma.thread.findUniqueOrThrow({ where: { id: thread.id } });
    expect(clearedThread.historyCompactedUpToSeq).toBe(clearedThread.nextMessageSeq - 1);
    expect(clearedThread.historyCompactionSummary).toBeNull();
    expect(clearedThread.historyCompactionGeneration).toBe(4);
    expect(await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: "cancelled",
    });
    expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: "cancelled",
    });
    expect(
      (await rpc<Bot[]>(app, cookie, "bots/list")).find((item) => item.id === bot.id),
    ).toMatchObject({
      preview: "",
      unread: false,
    });
    expect(
      await rpc(app, cookie, "computer/readFile", { botId: bot.id, path: "notes/result.txt" }),
    ).toMatchObject({ content: expect.stringContaining("kept-after-clear") });
    expect(await rpc(app, cookie, "memory/list", { botId: bot.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining("Remember this") }),
      ]),
    );
    expect(await rpc(app, cookie, "routines/list", { botId: bot.id })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: routine.id })]),
    );

    await expect(
      runAsSystem("background job run.continue", () =>
        appendEvent(appPrisma, {
          spaceId: thread.spaceId,
          threadId: thread.id,
          botId: bot.id,
          type: "thread.progress",
          runId: run.id,
          payload: { text: "stale output after clear" },
        }),
      ),
    ).rejects.toThrow(RunHistoryWriteError);
    await expect(
      runAsSystem("background job run.continue", () =>
        createThreadMessage(appPrisma, {
          threadId: thread.id,
          role: "bot",
          blocks: [{ kind: "text", text: "stale output after clear" }],
          runId: run.id,
        }),
      ),
    ).rejects.toThrow(RunHistoryWriteError);
    expect(await prisma.message.count({ where: { threadId: thread.id } })).toBe(0);
    expect(await prisma.event.findMany({ where: { threadId: thread.id } })).toMatchObject([
      { type: "thread.cleared" },
    ]);

    const after = await sendAndWait(
      app,
      cookie,
      bot.id,
      "write a file in your home called notes/after-clear.txt that says hello-after-clear",
    );
    expect(after.messages.length).toBeGreaterThan(0);
    expect(await prisma.message.count({ where: { threadId: thread.id } })).toBeGreaterThan(0);
  });

  it("2b: two Team bots send at once on distinct screens", async () => {
    const cookie = await signup(app, `parallel-j-${stamp}@rakazo.test`, "Parallel");
    const writer = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Writer",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const researcher = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Researcher",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const [writerSnap, researcherSnap] = await Promise.all([
      sendAndWait(app, cookie, writer.id, "observe your screen and type writer-desk"),
      sendAndWait(app, cookie, researcher.id, "observe your screen and type researcher-desk"),
    ]);
    expect(writerSnap.run?.status).toBe("completed");
    expect(researcherSnap.run?.status).toBe("completed");
    expect(
      (
        await rpc<{ busyBotName: string | null }>(app, cookie, "computer/status", {
          botId: writer.id,
        })
      ).busyBotName,
    ).toBeNull();
    expect(
      (
        await rpc<{ busyBotName: string | null }>(app, cookie, "computer/status", {
          botId: researcher.id,
        })
      ).busyBotName,
    ).toBeNull();
    const writerScreen = await rpc<{ url: string | null }>(app, cookie, "computer/screenUrl", {
      botId: writer.id,
    });
    const researcherScreen = await rpc<{ url: string | null }>(app, cookie, "computer/screenUrl", {
      botId: researcher.id,
    });
    const screenOf = (url: string | null) => {
      const sealed = new URL(url ?? "");
      const target = openScreenCapability(
        `${sealed.pathname}${sealed.search}`,
        resolveScreenProxySecret(),
      )?.target;
      return new URL(target?.path ?? "/", "http://screen.invalid").searchParams.get("screen");
    };
    expect(screenOf(writerScreen.url)).toBe(writer.id);
    expect(screenOf(researcherScreen.url)).toBe(researcher.id);
  });

  it("3: disconnect and reconnect from a cursor reconstructs the thread", async () => {
    const cookie = await signup(app, `cursor-j-${stamp}@rakazo.test`, "Cursor");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    await sendAndWait(
      app,
      cookie,
      bot.id,
      "write a file in your home called notes/result.txt that says reconnect-ok",
    );
    const snap = await rpc<Snap>(app, cookie, "threads/get", { botId: bot.id });
    expect(snap.messages.map((m) => m.seq)).toEqual(
      [...snap.messages].map((m) => m.seq).sort((a, b) => a - b),
    );
    expect(snap.messages.some((m) => JSON.stringify(m.blocks).includes("reconnect-ok"))).toBe(true);
    const again = await rpc<Snap>(app, cookie, "threads/get", { botId: bot.id });
    expect(again.messages.length).toBe(snap.messages.length);
  });

  it("4: takeover login then resume without exposing credentials", async () => {
    const cookie = await signup(app, `takeover-j-${stamp}@rakazo.test`, "Takeover");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    await rpc(app, cookie, "threads/send", {
      botId: bot.id,
      text: "install the gsc cli and sign in",
    });
    const waiting = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => snap.run?.status === "waiting_takeover",
    );
    expect(JSON.stringify(waiting.messages)).not.toMatch(/password|secret|token/i);
    await rpc(app, cookie, "computer/boot", { botId: bot.id });
    await rpc(app, cookie, "computer/takeover", { botId: bot.id });
    await rpc(app, cookie, "computer/release", { botId: bot.id });
    const done = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
    );
    expect(JSON.stringify(done.messages).toLowerCase()).toMatch(/signed in|session/);
    expect(done.run?.status ?? "completed").not.toBe("waiting_takeover");

    const releaseEvents = await prisma.event.count({
      where: { botId: bot.id, type: "computer.takeover.released" },
    });
    await rpc(app, cookie, "computer/release", { botId: bot.id });
    expect(
      await prisma.event.count({
        where: { botId: bot.id, type: "computer.takeover.released" },
      }),
    ).toBe(releaseEvents);
  });

  it("4d: skipping takeover resumes without treating login as done", async () => {
    const cookie = await signup(app, `takeover-skip-j-${stamp}@rakazo.test`, "Skip Takeover");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    await rpc(app, cookie, "threads/send", {
      botId: bot.id,
      text: "install the gsc cli and sign in",
    });
    const waiting = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => snap.run?.status === "waiting_takeover",
    );
    await rpc(app, cookie, "computer/boot", { botId: bot.id });
    await rpc(app, cookie, "computer/takeover", { botId: bot.id });
    await rpc(app, cookie, "computer/release", { botId: bot.id, reason: "skipped" });
    const done = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
    );
    expect(JSON.stringify(done.messages).toLowerCase()).toMatch(/skipped/);
    expect(JSON.stringify(done.messages).toLowerCase()).not.toMatch(/signed in/);
    expect(done.run?.status ?? "completed").not.toBe("waiting_takeover");
    const released = await prisma.event.findFirst({
      where: { botId: bot.id, type: "computer.takeover.released" },
      orderBy: { createdAt: "desc" },
    });
    expect(released).toMatchObject({
      runId: waiting.run?.id,
      payload: { reason: "skipped" },
    });
  });

  it("4e: deleting a group with a run waiting on takeover frees its bot's computer", async () => {
    const cookie = await signup(app, `takeover-group-delete-${stamp}@rakazo.test`, "Group Delete");
    const createBot = (name: string) =>
      rpc<Bot>(app, cookie, "bots/create", {
        name,
        title: "",
        instructions: "",
        notifyOnFinish: true,
      });
    const chief = await createBot("Chief");
    const mate = await createBot("Mate");
    const group = await rpc<{ id: string; threadId: string }>(app, cookie, "groups/create", {
      name: "Launch room",
      botIds: [chief.id, mate.id],
    });
    await rpc(app, cookie, "threads/send", {
      groupId: group.id,
      text: "@Chief install the gsc cli and sign in",
    });
    let waitingRunId: string | undefined;
    await waitForDatabase(async () => {
      const run = await prisma.run.findFirst({
        where: { threadId: group.threadId, botId: chief.id, status: "waiting_takeover" },
        select: { id: true },
      });
      waitingRunId = run?.id;
      return Boolean(run);
    });
    // The takeover holds Chief's computer for a day.
    const held = await prisma.computerExecutionLease.findFirstOrThrow({
      where: { botId: chief.id, runId: waitingRunId },
    });
    expect(held.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000);

    await rpc(app, cookie, "groups/remove", { groupId: group.id });

    expect(await prisma.run.findUnique({ where: { id: waitingRunId } })).toBeNull();
    // Chief's next run, in its own chat, takes the computer instead of waiting a day for it.
    const direct = await sendAndWait(app, cookie, chief.id, "hello again");
    expect(direct.run.status).toBe("completed");
    expect(
      await prisma.computerExecutionLease.findUniqueOrThrow({ where: { id: held.id } }),
    ).toMatchObject({ runId: direct.run.id, fence: held.fence + 1 });
  });

  it("4b: an expired takeover denies input and reconciles API and database state", async () => {
    const previousTakeoverTtl = process.env.COMPUTER_TAKEOVER_TTL_MS;
    process.env.COMPUTER_TAKEOVER_TTL_MS = "1000";
    try {
      const cookie = await signup(app, `takeover-expiry-j-${stamp}@rakazo.test`, "Expiry");
      const bot = await rpc<Bot>(app, cookie, "bots/create", {
        name: "Chief",
        title: "",
        instructions: "",
        notifyOnFinish: true,
      });
      await rpc(app, cookie, "threads/send", {
        botId: bot.id,
        text: "install the gsc cli and sign in",
      });
      const waiting = await waitFor(
        app,
        cookie,
        bot.id,
        (snap) => snap.run?.status === "waiting_takeover",
      );
      await rpc(app, cookie, "computer/boot", { botId: bot.id });
      const lease = await rpc<{ leaseId: string; expiresAt: string }>(
        app,
        cookie,
        "computer/takeover",
        { botId: bot.id },
      );
      expect(new Date(lease.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(1000);
      expect(
        (await rpc<{ url: string | null }>(app, cookie, "computer/screenUrl", { botId: bot.id }))
          .url,
      ).toContain("view_only=false");
      await rpc(app, cookie, "computer/input", {
        botId: bot.id,
        kind: "key",
        payload: { key: "a" },
      });

      await waitForDatabase(async () => {
        const storedBot = await prisma.bot.findUniqueOrThrow({
          where: { id: bot.id },
          include: { computer: true },
        });
        const computer = storedBot.computer!;
        return computer.controlLeaseId === null && computer.controlHolder === "none";
      });

      expect(
        (await rpc<{ controlHolder: string }>(app, cookie, "computer/status", { botId: bot.id }))
          .controlHolder,
      ).toBe("none");
      expect(
        (await rpc<{ url: string | null }>(app, cookie, "computer/screenUrl", { botId: bot.id }))
          .url,
      ).toContain("view_only=true");
      expect(
        (
          await raw(app, cookie, "computer/input", {
            botId: bot.id,
            kind: "key",
            payload: { key: "b" },
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
      const done = await waitFor(
        app,
        cookie,
        bot.id,
        (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
      );
      expect(JSON.stringify(done.messages).toLowerCase()).toMatch(/skipped/);
      expect(JSON.stringify(done.messages).toLowerCase()).not.toMatch(/signed in/);
      expect(done.run?.status ?? "completed").not.toBe("waiting_takeover");
      expect(
        await prisma.event.findFirst({
          where: { runId: waiting.run?.id, type: "computer.takeover.released" },
          orderBy: { createdAt: "desc" },
        }),
      ).toMatchObject({ payload: { reason: "expired" } });
    } finally {
      if (previousTakeoverTtl === undefined) delete process.env.COMPUTER_TAKEOVER_TTL_MS;
      else process.env.COMPUTER_TAKEOVER_TTL_MS = previousTakeoverTtl;
    }
  });

  it("4c: a takeover authorizes input only on the controlled bot screen", async () => {
    const cookie = await signup(app, `takeover-scope-j-${stamp}@rakazo.test`, "Takeover Scope");
    const writer = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Writer",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const researcher = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Researcher",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });

    await rpc(app, cookie, "computer/boot", { botId: writer.id });
    await rpc(app, cookie, "computer/takeover", { botId: writer.id });
    expect(
      (
        await raw(app, cookie, "computer/input", {
          botId: researcher.id,
          kind: "key",
          payload: { key: "A" },
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    await rpc(app, cookie, "computer/release", { botId: writer.id });
  });

  it("4d: a stale Team release cannot clear a newer bot takeover", async () => {
    const cookie = await signup(
      app,
      `takeover-release-fence-j-${stamp}@rakazo.test`,
      "Release Fence",
    );
    const writer = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Writer",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const researcher = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Researcher",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });

    await rpc(app, cookie, "computer/boot", { botId: writer.id });
    await rpc(app, cookie, "threads/send", {
      botId: researcher.id,
      text: "install the gsc cli and sign in",
    });
    await waitFor(app, cookie, researcher.id, (snap) => snap.run?.status === "waiting_takeover");

    const writerLease = await rpc<{ leaseId: string; expiresAt: string }>(
      app,
      cookie,
      "computer/takeover",
      { botId: writer.id },
    );
    const releaseEventsBefore = await prisma.event.count({
      where: { botId: researcher.id, type: "computer.takeover.released" },
    });

    const originalSetScreenControl = sandbox.setScreenControl;
    let signalReleaseRevocation!: () => void;
    let allowReleaseRevocation!: () => void;
    const releaseRevocationReached = new Promise<void>((resolve) => {
      signalReleaseRevocation = resolve;
    });
    const releaseRevocationAllowed = new Promise<void>((resolve) => {
      allowReleaseRevocation = resolve;
    });
    const revokedLeases: string[] = [];
    sandbox.setScreenControl = async (_computer, interactive, context, controlToken) => {
      expect(interactive).toBe(false);
      revokedLeases.push(controlToken ?? "");
      if (revokedLeases.length !== 1) return;
      expect(context.botId).toBe(writer.id);
      expect(controlToken).toBe(writerLease.leaseId);
      signalReleaseRevocation();
      await releaseRevocationAllowed;
    };

    let staleRelease: Promise<{ ok: true }> | undefined;
    let researcherLease!: { leaseId: string; expiresAt: string };
    try {
      // Pause Release after it captures Writer's lease but before database finalization. The
      // replacement takeover then commits first, so the resumed Release must lose its lease CAS.
      staleRelease = rpc<{ ok: true }>(app, cookie, "computer/release", { botId: writer.id });
      await releaseRevocationReached;
      researcherLease = await rpc<{ leaseId: string; expiresAt: string }>(
        app,
        cookie,
        "computer/takeover",
        { botId: researcher.id },
      );
      allowReleaseRevocation();
      await staleRelease;
    } finally {
      allowReleaseRevocation();
      await staleRelease?.catch(() => undefined);
      sandbox.setScreenControl = originalSetScreenControl;
    }

    expect(researcherLease.leaseId).not.toBe(writerLease.leaseId);
    expect(revokedLeases).toEqual([writerLease.leaseId, writerLease.leaseId]);

    const writerRecord = await prisma.bot.findUniqueOrThrow({
      where: { id: writer.id },
      include: { computer: true },
    });
    const researcherRecord = await prisma.bot.findUniqueOrThrow({
      where: { id: researcher.id },
      include: { computer: true },
    });
    const computerId = writerRecord.computer!.id;
    expect(researcherRecord.computer!.id).toBe(computerId);
    const afterStaleRelease = await prisma.computer.findUniqueOrThrow({
      where: { id: computerId },
    });
    expect(afterStaleRelease.controlHolder).toBe("user");
    expect(afterStaleRelease.controlBotId).toBe(researcher.id);
    expect(afterStaleRelease.controlLeaseId).toBe(researcherLease.leaseId);
    expect(afterStaleRelease.controlLeaseExpiresAt?.toISOString()).toBe(researcherLease.expiresAt);
    expect(
      await prisma.event.count({
        where: { botId: researcher.id, type: "computer.takeover.released" },
      }),
    ).toBe(releaseEventsBefore);
    expect(
      (
        await prisma.run.findFirstOrThrow({
          where: { botId: researcher.id, status: "waiting_takeover" },
        })
      ).status,
    ).toBe("waiting_takeover");

    await rpc(app, cookie, "computer/release", { botId: researcher.id });
    const afterOwnerRelease = await prisma.computer.findUniqueOrThrow({
      where: { id: computerId },
    });
    expect(afterOwnerRelease).toMatchObject({
      controlHolder: "bot",
      controlBotId: null,
      controlLeaseId: null,
      controlLeaseExpiresAt: null,
    });
    await waitFor(
      app,
      cookie,
      researcher.id,
      (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
    );
    expect(
      await prisma.event.count({
        where: { botId: researcher.id, type: "computer.takeover.released" },
      }),
    ).toBe(releaseEventsBefore + 1);
    const releaseEvent = await prisma.event.findFirstOrThrow({
      where: { botId: researcher.id, type: "computer.takeover.released" },
      orderBy: { seq: "desc" },
    });
    expect(releaseEvent.payload).toMatchObject({
      holder: "bot",
      leaseId: researcherLease.leaseId,
      reason: "released",
    });

    await rpc(app, cookie, "computer/release", { botId: researcher.id });
    expect(
      await prisma.event.count({
        where: { botId: researcher.id, type: "computer.takeover.released" },
      }),
    ).toBe(releaseEventsBefore + 1);
  });

  it("4e: concurrent Team takeovers never return another bot's lease", async () => {
    const cookie = await signup(
      app,
      `takeover-owner-race-j-${stamp}@rakazo.test`,
      "Takeover Owner Race",
    );
    const writer = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Writer",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const researcher = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Researcher",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const analyst = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Analyst",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });

    await rpc(app, cookie, "computer/boot", { botId: writer.id });
    const writerLease = await rpc<{ leaseId: string }>(app, cookie, "computer/takeover", {
      botId: writer.id,
    });

    const originalSetScreenControl = sandbox.setScreenControl;
    let revocations = 0;
    let releaseRevocations!: () => void;
    const bothRevocationsReached = new Promise<void>((resolve) => {
      releaseRevocations = resolve;
    });
    const barrierTimeout = setTimeout(releaseRevocations, 1_000);
    sandbox.setScreenControl = async (_computer, interactive, _context, controlToken) => {
      expect(interactive).toBe(false);
      expect(controlToken).toBe(writerLease.leaseId);
      revocations += 1;
      if (revocations === 2) releaseRevocations();
      await bothRevocationsReached;
    };

    let responses: Response[] = [];
    try {
      responses = await Promise.all([
        raw(app, cookie, "computer/takeover", { botId: researcher.id }),
        raw(app, cookie, "computer/takeover", { botId: analyst.id }),
      ]);
    } finally {
      clearTimeout(barrierTimeout);
      releaseRevocations();
      sandbox.setScreenControl = originalSetScreenControl;
    }

    expect(revocations).toBe(2);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const computer = await prisma.computer.findFirstOrThrow({
      where: { bots: { some: { id: writer.id } } },
      select: { controlBotId: true, controlLeaseId: true },
    });
    const winner = computer.controlBotId === researcher.id ? researcher : analyst;
    const successfulResponse = responses.find((response) => response.status === 200)!;
    await expect(successfulResponse.clone().json()).resolves.toMatchObject({
      json: { leaseId: computer.controlLeaseId },
    });

    await rpc(app, cookie, "computer/release", { botId: winner.id });
  });

  it("5: a routine wakes the bot and posts into the existing thread", async () => {
    const cookie = await signup(app, `routine-j-${stamp}@rakazo.test`, "Routine");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const routine = await rpc<{ id: string; nextRunAt: string | null }>(
      app,
      cookie,
      "routines/create",
      {
        botId: bot.id,
        name: "Monday briefing",
        prompt: "write a file in your home called notes/result.txt that says routine-ok",
        crons: ["0 9 * * 1"],
        timezone: "UTC",
        notify: true,
        active: true,
      },
    );
    expect(routine.nextRunAt).toBeTruthy();
    const dueAt = new Date(Date.now() - 1_000);
    await prisma.routine.update({
      where: { id: routine.id },
      data: { nextRunAt: dueAt },
    });
    await jobs.enqueue({
      name: "routine.wakeup",
      payload: { routineId: routine.id, scheduledFor: dueAt.toISOString() },
    });
    await jobs.enqueue({
      name: "routine.wakeup",
      payload: { routineId: routine.id, scheduledFor: dueAt.toISOString() },
    });
    const snap = await waitFor(app, cookie, bot.id, (s) =>
      s.messages.some(
        (m) =>
          JSON.stringify(m.blocks).includes("routine-ok") ||
          JSON.stringify(m.blocks).includes("writing"),
      ),
    );
    expect(snap.messages.length).toBeGreaterThan(0);
    const routineRuns = await prisma.run.count({
      where: { botId: bot.id, trigger: "routine" },
    });
    expect(routineRuns).toBe(1);
    const advanced = await prisma.routine.findUniqueOrThrow({ where: { id: routine.id } });
    expect(advanced.nextRunAt?.getTime()).toBeGreaterThan(dueAt.getTime());

    const legacyRunsBefore = await prisma.run.count({
      where: { botId: bot.id, trigger: "routine" },
    });
    const legacyDueAt = new Date(Date.now() - 1_000);
    const legacy = await prisma.routine.create({
      data: {
        spaceId: advanced.spaceId,
        userId: advanced.userId,
        botId: bot.id,
        name: "Legacy schedule",
        prompt: "Run the legacy schedule once",
        crons: ["0 0 9 * * *"],
        timezone: "UTC",
        notify: false,
        active: true,
        nextRunAt: legacyDueAt,
      },
    });
    await jobs.enqueue({
      name: "routine.wakeup",
      payload: { routineId: legacy.id, scheduledFor: legacyDueAt.toISOString() },
    });
    await waitForDatabase(async () => {
      const stored = await prisma.routine.findUnique({ where: { id: legacy.id } });
      return stored?.active === false && stored.nextRunAt === null;
    });
    expect(await prisma.run.count({ where: { botId: bot.id, trigger: "routine" } })).toBe(
      legacyRunsBefore + 1,
    );
  });

  it("5b: tool-created schedules wake in the creating group or 1:1 thread", async () => {
    const cookie = await signup(app, `schedule-dest-j-${stamp}@rakazo.test`, "Schedule Dest");
    const me = await rpc<Me>(app, cookie, "me");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Scheduler",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const peer = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Peer",
      title: "",
      instructions: "",
      notifyOnFinish: false,
    });
    const dmThread = await prisma.thread.findUniqueOrThrow({ where: { botId: bot.id } });
    const group = await rpc<{ id: string; threadId: string }>(app, cookie, "groups/create", {
      name: "Schedule room",
      botIds: [bot.id, peer.id],
    });
    const scheduleDeps = { prisma: appPrisma, events: createThreadEvents(appPrisma), jobs };

    const groupCreated = await runAsSystem("background job run.continue", () =>
      createScheduleFromTool(scheduleDeps, {
        spaceId: me.spaceId,
        botId: bot.id,
        userId: me.userId,
        threadId: group.threadId,
        name: "Group ping",
        prompt: "say group-reminder-ok",
        schedule: { delaySeconds: 30 },
      }),
    );
    expect(groupCreated).toMatchObject({ ok: true });
    if (!("ok" in groupCreated) || !groupCreated.ok)
      throw new Error("group schedule create failed");
    const groupRoutine = await prisma.routine.findUniqueOrThrow({
      where: { id: groupCreated.routineId },
    });
    expect(groupRoutine.threadId).toBe(group.threadId);
    expect(groupRoutine.crons).toEqual([ONCE_ROUTINE_CRON]);

    const groupDueAt = new Date(Date.now() - 1_000);
    await prisma.routine.update({
      where: { id: groupRoutine.id },
      data: { nextRunAt: groupDueAt },
    });
    await runAsSystem("background job routine.wakeup", () =>
      executor.wakeRoutine(groupRoutine.id, groupDueAt.toISOString()),
    );
    await waitForDatabase(async () => {
      const run = await prisma.run.findFirst({
        where: { routineId: groupRoutine.id, trigger: "routine" },
      });
      return run?.threadId === group.threadId;
    });
    const groupRun = await prisma.run.findFirstOrThrow({
      where: { routineId: groupRoutine.id, trigger: "routine" },
    });
    expect(groupRun.threadId).toBe(group.threadId);
    expect(groupRun.threadId).not.toBe(dmThread.id);
    expect(
      await prisma.event.count({
        where: {
          threadId: group.threadId,
          type: "routine.fired",
          runId: groupRun.id,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.event.count({
        where: {
          threadId: dmThread.id,
          type: "routine.fired",
          runId: groupRun.id,
        },
      }),
    ).toBe(0);

    const dmCreated = await runAsSystem("background job run.continue", () =>
      createScheduleFromTool(scheduleDeps, {
        spaceId: me.spaceId,
        botId: bot.id,
        userId: me.userId,
        threadId: dmThread.id,
        name: "DM ping",
        prompt: "say dm-reminder-ok",
        schedule: { delaySeconds: 30 },
      }),
    );
    expect(dmCreated).toMatchObject({ ok: true });
    if (!("ok" in dmCreated) || !dmCreated.ok) throw new Error("dm schedule create failed");
    const dmRoutine = await prisma.routine.findUniqueOrThrow({
      where: { id: dmCreated.routineId },
    });
    expect(dmRoutine.threadId).toBe(dmThread.id);

    const dmDueAt = new Date(Date.now() - 1_000);
    await prisma.routine.update({
      where: { id: dmRoutine.id },
      data: { nextRunAt: dmDueAt },
    });
    await runAsSystem("background job routine.wakeup", () =>
      executor.wakeRoutine(dmRoutine.id, dmDueAt.toISOString()),
    );
    await waitForDatabase(async () => {
      const run = await prisma.run.findFirst({
        where: { routineId: dmRoutine.id, trigger: "routine" },
      });
      return run?.threadId === dmThread.id;
    });
    const dmRun = await prisma.run.findFirstOrThrow({
      where: { routineId: dmRoutine.id, trigger: "routine" },
    });
    expect(dmRun.threadId).toBe(dmThread.id);
    expect(
      await prisma.event.count({
        where: {
          threadId: dmThread.id,
          type: "routine.fired",
          runId: dmRun.id,
        },
      }),
    ).toBe(1);
  });

  it("allocates event and message cursors atomically under concurrent writes", async () => {
    const cookie = await signup(app, `sequence-j-${stamp}@rakazo.test`, "Sequence");
    const actor = await rpc<Me>(app, cookie, "me");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Sequencer",
      title: "",
      instructions: "",
      notifyOnFinish: false,
    });
    const thread = await prisma.thread.findUniqueOrThrow({ where: { botId: bot.id } });

    await runAsSystem("background job run.continue", () =>
      Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          appendEvent(appPrisma, {
            spaceId: actor.spaceId,
            threadId: thread.id,
            botId: bot.id,
            type: "thread.progress",
            payload: { delta: String(index) },
          }),
        ),
      ),
    );
    await runAsSystem("background job run.continue", () =>
      Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          createThreadMessage(appPrisma, {
            threadId: thread.id,
            role: "system",
            blocks: [{ kind: "meta", text: String(index) }],
          }),
        ),
      ),
    );

    const [events, messages] = await Promise.all([
      prisma.event.findMany({ where: { threadId: thread.id }, orderBy: { seq: "asc" } }),
      prisma.message.findMany({ where: { threadId: thread.id }, orderBy: { seq: "asc" } }),
    ]);
    expect(events.map((row) => row.seq)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(messages.map((row) => row.seq)).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  it("6: fake and desktop executor run the same graphical task", async () => {
    const ctx = {
      operationId: "1",
      traceId: "1",
      spaceId: "w",
      userId: "u",
      signal: new AbortController().signal,
    };
    const fake = new FakeSandboxProvider();
    const desktop = new DesktopSandboxProvider();
    const a = await fake.provision({ botId: "ja", homePath: "/tmp/ja" }, ctx);
    const c = await desktop.provision({ botId: "jc", homePath: "/tmp/jc" }, ctx);
    let out = "";
    for await (const event of fake.execute(a, { argv: ["echo", "same-task"] }, ctx)) {
      if (event.type === "stdout") out += event.data;
    }
    for await (const event of desktop.execute(c, { argv: ["echo", "same-task"] }, ctx)) {
      if (event.type === "stdout") out += event.data;
    }
    expect(out.match(/same-task/g)?.length).toBe(2);
    await desktop.destroy(c, ctx);
  });

  it("7: destination write is independently inspectable and credentials stay out of the thread", async () => {
    const cookie = await signup(app, `dest-j-${stamp}@rakazo.test`, "Dest");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const before = connector.records.length;
    const secret = "test-openrouter-key-not-a-real-secret";
    await rpc(app, cookie, "models/connect", {
      provider: "openrouter",
      apiKey: secret,
      label: "test",
      modelId: "scripted",
    });
    await runWithoutAsking(cookie);
    await sendAndWait(app, cookie, bot.id, "write this to the destination crm as a note");
    expect(connector.records.length).toBeGreaterThan(before);
    const snap = await rpc<Snap>(app, cookie, "threads/get", { botId: bot.id });
    expect(JSON.stringify(snap)).not.toContain(secret);
  });

  it("8: retrying a completed effect does not duplicate the destination write", async () => {
    const cookie = await signup(app, `crash-j-${stamp}@rakazo.test`, "Crash");
    await runWithoutAsking(cookie);
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const before = connector.records.length;
    const sent = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "write this to the destination crm as a note",
    });
    await waitFor(
      app,
      cookie,
      bot.id,
      (s) => !s.run || ["completed", "failed", "cancelled"].includes(s.run.status),
    );
    const afterFirst = connector.records.length;
    expect(afterFirst).toBeGreaterThan(before);
    await prisma.run.update({
      where: { id: sent.runId },
      data: { status: "running", completedAt: null },
    });
    await runAsSystem("background job run.continue", () =>
      executor.continueRun(sent.runId, "retry"),
    );
    expect(connector.records.length).toBe(afterFirst);
  });

  it("9: export includes memory and the bot's own files but not secrets or browser sessions", async () => {
    const cookie = await signup(app, `export-j-${stamp}@rakazo.test`, "Export");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "Be useful",
      notifyOnFinish: true,
    });
    const secret = "test-openrouter-key-not-a-real-secret";
    await rpc(app, cookie, "models/connect", {
      provider: "openrouter",
      apiKey: secret,
      label: "hidden",
      modelId: "scripted",
    });
    await sendAndWait(
      app,
      cookie,
      bot.id,
      "write a file in your home called notes/result.txt that says export-ok",
    );
    const other = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Other",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    await sendAndWait(
      app,
      cookie,
      other.id,
      "write a file in your home called notes/other.txt that says other-bot-private",
    );
    const manifest = await rpc<{ files: Array<{ path: string }> }>(app, cookie, "export/bot", {
      botId: bot.id,
    });
    const rawJson = JSON.stringify(manifest);
    expect(manifest.files.map((file) => file.path)).toContain("notes/result.txt");
    expect(rawJson).toContain("export-ok");
    expect(rawJson).not.toContain("other-bot-private");
    expect(rawJson).toContain("Be useful");
    expect(rawJson).not.toContain(secret);
    expect(rawJson).not.toMatch(/browserProfile|ciphertext|sessionCookie/i);
  });

  it("10: bots can be archived safely and deleted with or without their memories", async () => {
    const ada = await signup(app, `delete-j-${stamp}@rakazo.test`, "Delete Ada");
    const bob = await signup(app, `delete-bob-j-${stamp}@rakazo.test`, "Delete Bob");
    const keep = await rpc<Bot>(app, ada, "bots/create", {
      name: "Keep",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const gone = await rpc<Bot>(app, ada, "bots/create", {
      name: "Gone",
      title: "",
      instructions: "",
      notifyOnFinish: true,
      computerMode: "dedicated",
    });
    const forget = await rpc<Bot>(app, ada, "bots/create", {
      name: "Forget",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const goneMemory = await prisma.memoryDocument.findFirstOrThrow({ where: { botId: gone.id } });
    const forgetMemory = await prisma.memoryDocument.findFirstOrThrow({
      where: { botId: forget.id },
    });
    await prisma.memoryDocument.update({
      where: { id: goneMemory.id },
      data: { content: "important retained context" },
    });
    await sendAndWait(
      app,
      ada,
      gone.id,
      "write a file in your home called notes/result.txt that says delete-ok",
    );
    const goneArtifact = await rpc<{ id: string }>(app, ada, "artifacts/create", {
      botId: gone.id,
      name: "delete-me.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("fake artifact content").toString("base64"),
    });
    const home = path.join(dataDir, "homes", gone.id);
    expect(existsSync(home)).toBe(true);
    // Spend that really happened. The scripted runtime emits no usage event, so the row is
    // written directly, the same way this file creates runs and tasks elsewhere.
    const goneBotRow = await prisma.bot.findUniqueOrThrow({
      where: { id: gone.id },
      select: { spaceId: true, userId: true },
    });
    const goneSpend = await prisma.usageRecord.create({
      data: {
        spaceId: goneBotRow.spaceId,
        botId: gone.id,
        userId: goneBotRow.userId,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        inputTokens: 1200,
        outputTokens: 340,
      },
    });

    const stolen = await raw(app, bob, "bots/archive", { botId: gone.id });
    expect(stolen.status).toBeGreaterThanOrEqual(400);
    expect((await rpc<Bot[]>(app, ada, "bots/list")).map((bot) => bot.id)).toContain(gone.id);

    await rpc(app, ada, "bots/archive", { botId: gone.id });
    expect((await rpc<Bot[]>(app, ada, "bots/list")).map((bot) => bot.id)).not.toContain(gone.id);
    expect(await prisma.artifact.findUnique({ where: { id: goneArtifact.id } })).not.toBeNull();
    expect(existsSync(home)).toBe(true);

    await rpc(app, ada, "bots/remove", { botId: gone.id, deleteMemories: false });
    const list = await rpc<Bot[]>(app, ada, "bots/list");
    expect(list.map((bot) => bot.id)).toEqual(expect.arrayContaining([keep.id, forget.id]));
    expect((await raw(app, ada, "bots/get", { botId: gone.id })).status).toBeGreaterThanOrEqual(
      400,
    );
    expect(
      await prisma.memoryDocument.findUniqueOrThrow({ where: { id: goneMemory.id } }),
    ).toMatchObject({
      botId: null,
      scope: "user",
      content: "important retained context",
    });
    // The name is the half that makes a detached usage row readable: bot_deletions is keyed by
    // the bot id, so a per-bot spend report can still label spend that belongs to a bot that
    // no longer exists.
    expect(await prisma.botDeletion.findUniqueOrThrow({ where: { id: gone.id } })).toMatchObject({
      name: "Gone",
      memoriesPreserved: true,
    });
    expect(await prisma.artifact.findUnique({ where: { id: goneArtifact.id } })).toBeNull();
    expect(existsSync(home)).toBe(false);
    // Deleting a bot must not erase what it cost, nor which bot cost it. botId has no foreign
    // key, so it outlives the bot and stays joinable against bot_deletions for the name.
    expect(
      await prisma.usageRecord.findUniqueOrThrow({ where: { id: goneSpend.id } }),
    ).toMatchObject({ botId: gone.id, inputTokens: 1200, outputTokens: 340 });

    await rpc(app, ada, "bots/remove", { botId: forget.id, deleteMemories: true });
    expect(await prisma.memoryDocument.findUnique({ where: { id: forgetMemory.id } })).toBeNull();
  });

  it("11: deleting an account removes the user and personal workspace data", async () => {
    const email = `account-delete-j-${stamp}@rakazo.test`;
    const cookie = await signup(app, email, "Delete Account");
    const me = await rpc<Me>(app, cookie, "me");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Temporary",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });

    const deleted = await app.request("/api/auth/delete-user", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "http://127.0.0.1:5173",
      },
      body: JSON.stringify({ password: "password12" }),
    });

    expect(deleted.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: me.userId } })).toBeNull();
    expect(await prisma.organization.findUnique({ where: { id: me.spaceId } })).toBeNull();
    expect(await prisma.bot.findUnique({ where: { id: bot.id } })).toBeNull();
    expect((await raw(app, cookie, "me")).status).toBeGreaterThanOrEqual(400);
  });

  it("12b: a bot can silence and resume its own finish notifications", async () => {
    const cookie = await signup(app, `notify-finish-j-${stamp}@rakazo.test`, "Notify");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    expect(bot.notifyOnFinish).toBe(true);

    await sendAndWait(app, cookie, bot.id, "silence finish notifications");
    const silenced = (await rpc<Bot[]>(app, cookie, "bots/list")).find((row) => row.id === bot.id);
    expect(silenced?.notifyOnFinish).toBe(false);
    expect((await rpc<Bot>(app, cookie, "bots/get", { botId: bot.id })).notifyOnFinish).toBe(false);

    await sendAndWait(app, cookie, bot.id, "resume finish notifications");
    expect(
      (await rpc<Bot[]>(app, cookie, "bots/list")).find((row) => row.id === bot.id)?.notifyOnFinish,
    ).toBe(true);
    expect((await rpc<Bot>(app, cookie, "bots/get", { botId: bot.id })).notifyOnFinish).toBe(true);
  });

  it("13: a subagent shows up in the parent thread without creating a bot", async () => {
    const cookie = await signup(app, `subagent-j-${stamp}@rakazo.test`, "Subagent");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const before = (await rpc<Bot[]>(app, cookie, "bots/list")).length;
    const snap = await sendAndWait(app, cookie, bot.id, "run a subagent to summarize the notes");
    expect(JSON.stringify(snap.messages)).toMatch(/subagent|helper/);
    expect(await rpc<Bot[]>(app, cookie, "bots/list")).toHaveLength(before);
  });

  it("14: this-mac is refused unless the sandbox is docker", async () => {
    const cookie = await signup(app, `host-j-${stamp}@rakazo.test`, "Host");
    const me = await rpc<Me>(app, cookie, "me");
    expect(me.canChooseHostComputer).toBe(false);
    await prisma.deploymentSettings.update({
      where: { id: "default" },
      data: { ownerUserId: me.userId },
    });
    const res = await raw(app, cookie, "deployment/update", { computerHost: "this-mac" });
    const text = await res.text();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBe(403);
    expect(text).toMatch(/FORBIDDEN/);
  });

  it("15: ask, answer, stop, follow-up, and clientNonce stay consistent", async () => {
    const cookie = await signup(app, `ask-j-${stamp}@rakazo.test`, "Ask");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });

    const asked = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "ask me which city to use",
    });
    const waiting = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => snap.run?.status === "waiting_input",
    );
    expect(JSON.stringify(waiting.messages)).toMatch(/which city/i);
    const askMessage = waiting.messages.find((message) =>
      message.blocks.some((block) => block.kind === "ask"),
    );
    expect(askMessage).toBeTruthy();
    await rpc(app, cookie, "threads/answer", {
      botId: bot.id,
      runId: asked.runId,
      messageId: askMessage!.id,
      answer: "Paris",
    });
    const answered = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
    );
    expect(answered.run?.status ?? "completed").toBe("completed");

    await rpc(app, cookie, "threads/send", {
      botId: bot.id,
      text: "keep working until I stop you",
    });
    await waitFor(app, cookie, bot.id, (snap) =>
      ["queued", "leased", "running"].includes(snap.run?.status ?? ""),
    );
    const hanging = await prisma.run.findFirstOrThrow({
      where: { botId: bot.id },
      orderBy: { createdAt: "desc" },
    });
    await rpc(app, cookie, "threads/stop", { botId: bot.id });
    await waitFor(app, cookie, bot.id, (snap) => !snap.run);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: hanging.id } })).status).toBe(
      "cancelled",
    );

    await rpc(app, cookie, "threads/send", {
      botId: bot.id,
      text: "write a file in your home called notes/result.txt that says followup-ok",
    });
    await waitFor(
      app,
      cookie,
      bot.id,
      (s) => !s.run || ["completed", "failed", "cancelled"].includes(s.run.status),
    );
    expect(
      (
        await rpc<{ content: string }>(app, cookie, "computer/readFile", {
          botId: bot.id,
          path: "notes/result.txt",
        })
      ).content,
    ).toContain("followup-ok");

    const first = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "write a file in your home called notes/result.txt that says nonce-ok",
      clientNonce: `nonce-${stamp}`,
    });
    const second = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "write a file in your home called notes/result.txt that says nonce-dup",
      clientNonce: `nonce-${stamp}`,
    });
    expect(second.runId).toBe(first.runId);
    await waitFor(
      app,
      cookie,
      bot.id,
      (s) => !s.run || ["completed", "failed", "cancelled"].includes(s.run.status),
    );
    const file = await rpc<{ content: string }>(app, cookie, "computer/readFile", {
      botId: bot.id,
      path: "notes/result.txt",
    });
    expect(file.content).toContain("nonce-ok");
    expect(file.content).not.toContain("nonce-dup");
  });

  it("15b: a free-text chat message answers a waiting ask", async () => {
    const cookie = await signup(app, `ask-freetext-j-${stamp}@rakazo.test`, "Ask Free");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });

    const asked = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "ask me which city to use",
    });
    const waiting = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => snap.run?.id === asked.runId && snap.run.status === "waiting_input",
    );
    expect(
      waiting.messages.some((message) =>
        message.blocks.some((block) => block.kind === "ask" && block.status !== "answered"),
      ),
    ).toBe(true);

    const reply = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "Paris",
      clientNonce: `ask-freetext-${stamp}`,
    });
    expect(reply.runId).toBe(asked.runId);
    const answered = await waitFor(app, cookie, bot.id, (snap) =>
      snap.messages.some((message) =>
        message.blocks.some(
          (block) =>
            block.kind === "ask" && block.status === "answered" && block.answer === "Paris",
        ),
      ),
    );
    expect(
      answered.messages.flatMap((message) => message.blocks).find((block) => block.kind === "ask"),
    ).toMatchObject({ status: "answered", answer: "Paris" });
    await waitForDatabase(async () => {
      const run = await prisma.run.findUnique({ where: { id: asked.runId } });
      return run?.status === "completed";
    });
    expect((await prisma.run.findUniqueOrThrow({ where: { id: asked.runId } })).status).toBe(
      "completed",
    );
  });

  it("15c: a bare stop message ends the work like Stop, and is an ordinary message when idle", async () => {
    const cookie = await signup(app, `stop-msg-j-${stamp}@rakazo.test`, "Stop Ada");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const notes = (snap: Snap) =>
      snap.messages.flatMap((message) =>
        message.blocks.filter((block) => block.kind === "meta").map((block) => block.text),
      );

    const working = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "keep working until I stop you",
    });
    await waitFor(app, cookie, bot.id, (snap) => snap.run?.status === "running");
    // With a file attached it is not just "stop": it steers like any message.
    const file = await rpc<{ id: string }>(app, cookie, "artifacts/create", {
      botId: bot.id,
      name: "stop.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("stop").toString("base64"),
    });
    await rpc(app, cookie, "threads/send", { botId: bot.id, text: "stop", artifactIds: [file.id] });
    expect((await prisma.run.findUniqueOrThrow({ where: { id: working.runId } })).status).toBe(
      "running",
    );
    const stop = { botId: bot.id, text: " Stop now! ", clientNonce: `stop-msg-${stamp}` };
    const stopped = await rpc<{ runId: string }>(app, cookie, "threads/send", stop);
    expect(stopped.runId).toBe(working.runId);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: working.runId } })).status).toBe(
      "cancelled",
    );
    const afterStop = await rpc<Snap>(app, cookie, "threads/get", { botId: bot.id });
    expect(afterStop.run).toBeNull();
    expect(notes(afterStop)).toEqual(["Stopped. Anything already done stays done."]);
    expect(await prisma.steeringMessage.count({ where: { botId: bot.id } })).toBe(0);

    // A retried stop is the same send: it leaves newer work alone.
    const newer = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "keep working until I stop you",
    });
    await waitFor(app, cookie, bot.id, (snap) => snap.run?.status === "running");
    expect((await rpc<{ runId: string }>(app, cookie, "threads/send", stop)).runId).toBe(
      working.runId,
    );
    expect((await prisma.run.findUniqueOrThrow({ where: { id: newer.runId } })).status).toBe(
      "running",
    );
    await rpc(app, cookie, "threads/stop", { botId: bot.id });
    expect(notes(await rpc<Snap>(app, cookie, "threads/get", { botId: bot.id }))).toHaveLength(1);

    // A waiting card is work too: stop cancels it instead of answering it.
    const asked = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "ask me which city to use",
    });
    await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => snap.run?.id === asked.runId && snap.run.status === "waiting_input",
    );
    const stoppedCard = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "stop",
    });
    expect(stoppedCard.runId).toBe(asked.runId);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: asked.runId } })).status).toBe(
      "cancelled",
    );
    const afterCard = await rpc<Snap>(app, cookie, "threads/get", { botId: bot.id });
    expect(afterCard.messages.flatMap((message) => message.blocks)).not.toContainEqual(
      expect.objectContaining({ kind: "ask", answer: "stop" }),
    );
    expect(notes(afterCard)).toHaveLength(2);

    // Nothing running: "stop" starts an ordinary turn and adds no note.
    const idle = await sendAndWait(app, cookie, bot.id, "stop");
    expect([working.runId, asked.runId]).not.toContain(idle.run.id);
    expect(notes(idle)).toHaveLength(2);
  });

  it("16: routine test-run and plugin connect/revoke", async () => {
    const ada = await signup(app, `plug-j-${stamp}@rakazo.test`, "Plug Ada");
    const bob = await signup(app, `plug-bob-j-${stamp}@rakazo.test`, "Plug Bob");
    const bot = await rpc<Bot>(app, ada, "bots/create", {
      name: "Chief",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const routine = await rpc<{ id: string }>(app, ada, "routines/create", {
      botId: bot.id,
      name: "Test now",
      prompt: "write a file in your home called notes/result.txt that says testrun-ok",
      crons: ["0 9 * * 1"],
      timezone: "UTC",
      notify: false,
      active: false,
    });
    const tested = await rpc<{ runId: string }>(app, ada, "routines/testRun", {
      routineId: routine.id,
    });
    expect(tested.runId).toBeTruthy();
    await waitFor(
      app,
      ada,
      bot.id,
      (s) => !s.run || ["completed", "failed", "cancelled"].includes(s.run.status),
    );
    const file = await rpc<{ content: string }>(app, ada, "computer/readFile", {
      botId: bot.id,
      path: "notes/result.txt",
    });
    expect(file.content).toContain("testrun-ok");

    const started = await rpc<{ connectionId: string; authorizationUrl: string | null }>(
      app,
      ada,
      "connections/begin",
      { provider: "gmail", displayName: "Gmail" },
    );
    expect(started.authorizationUrl).toBeNull();
    const connected = await rpc<{ status: string }>(app, ada, "connections/complete", {
      connectionId: started.connectionId,
    });
    expect(connected.status).toBe("connected");
    await rpc(app, bob, "connections/revoke", { connectionId: started.connectionId });
    expect(
      (await rpc<Array<{ id: string; status: string }>>(app, ada, "connections/list")).find(
        (row) => row.id === started.connectionId,
      )?.status,
    ).toBe("connected");
    await rpc(app, ada, "connections/revoke", { connectionId: started.connectionId });
    expect(
      (await rpc<Array<{ id: string; status: string }>>(app, ada, "connections/list")).find(
        (row) => row.id === started.connectionId,
      )?.status,
    ).toBe("revoked");
  });

  it("17: teach a task end to end", async () => {
    const cookie = await signup(app, `teach-j-${stamp}@rakazo.test`, "Teach Ada");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Teacher",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    await rpc(app, cookie, "computer/boot", { botId: bot.id });
    await rpc(app, cookie, "computer/takeover", { botId: bot.id });
    void rpc(app, cookie, "threads/send", {
      botId: bot.id,
      text: "keep working until I stop you",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const skill = await rpc<{
      id: string;
      status: string;
      playbook: { steps: string[] };
      recording: { events: Array<{ kind: string }> };
    }>(app, cookie, "skills/start", {
      botId: bot.id,
      goal: "Export weekly CRM list",
    });
    expect(skill.status).toBe("recording");
    await rpc(app, cookie, "computer/input", {
      botId: bot.id,
      kind: "pointer",
      payload: { x: 120, y: 40, button: "left", type: "click" },
    });
    await rpc(app, cookie, "computer/input", {
      botId: bot.id,
      kind: "key",
      payload: { key: "x" },
    });
    const blocked = await raw(app, cookie, "threads/send", {
      botId: bot.id,
      text: "please act now",
    });
    expect(blocked.status).toBeGreaterThanOrEqual(400);
    const stopped = await rpc<{
      status: string;
      playbook: { steps: string[] };
      recording: { events: Array<{ kind: string }>; snapshots: Array<{ summary: string }> };
    }>(app, cookie, "skills/stop", { skillId: skill.id });
    expect(stopped.status).toBe("draft");
    expect(stopped.playbook.steps.join(" ")).toMatch(/Click|120|40|x/i);
    expect(stopped.recording.events.some((event) => event.kind === "pointer")).toBe(true);
    expect(stopped.recording.snapshots.length).toBeGreaterThanOrEqual(2);
    const computerAfterStop = await rpc<{ controlHolder: string; controlBotId: string | null }>(
      app,
      cookie,
      "computer/status",
      { botId: bot.id },
    );
    expect(computerAfterStop.controlHolder).toBe("bot");
    expect(computerAfterStop.controlBotId).toBeNull();
    await rpc(app, cookie, "skills/updateDraft", {
      skillId: skill.id,
      name: "Export weekly CRM list",
      playbook: stopped.playbook,
    });
    const saved = await rpc<{ status: string; name: string }>(app, cookie, "skills/save", {
      skillId: skill.id,
      name: "Export weekly CRM list",
    });
    expect(saved.status).toBe("saved");
    const listed = await rpc<Array<{ id: string; name: string }>>(app, cookie, "skills/list", {
      botId: bot.id,
    });
    expect(listed.some((row) => row.id === skill.id)).toBe(true);
    const testRun = await rpc<{ runId: string }>(app, cookie, "skills/testRun", {
      skillId: skill.id,
    });
    expect(testRun.runId).toBeTruthy();
    await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
    );
    await sendAndWait(app, cookie, bot.id, "run Export weekly CRM list");
    const messages = (await rpc<Snap>(app, cookie, "threads/get", { botId: bot.id })).messages;
    const botText = JSON.stringify(messages);
    expect(botText.toLowerCase()).toContain("taught skill");
  });

  it("18: teaching expiry auto-stops recording", async () => {
    const previousTtl = process.env.TEACH_RECORDING_TTL_MS;
    process.env.TEACH_RECORDING_TTL_MS = "1000";
    try {
      const cookie = await signup(app, `teach-exp-j-${stamp}@rakazo.test`, "Teach Exp Ada");
      const bot = await rpc<Bot>(app, cookie, "bots/create", {
        name: "Timer",
        title: "",
        instructions: "",
        notifyOnFinish: true,
      });
      await rpc(app, cookie, "computer/boot", { botId: bot.id });
      await rpc(app, cookie, "computer/takeover", { botId: bot.id });
      const skill = await rpc<{ id: string; status: string }>(app, cookie, "skills/start", {
        botId: bot.id,
        goal: "Timed demo",
      });
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const current = await rpc<{ status: string }>(app, cookie, "skills/get", {
        skillId: skill.id,
      });
      expect(["draft", "drafting"].includes(current.status)).toBe(true);
    } finally {
      if (previousTtl === undefined) delete process.env.TEACH_RECORDING_TTL_MS;
      else process.env.TEACH_RECORDING_TTL_MS = previousTtl;
    }
  });

  it("19: in Ask mode, destination writes pause for approval before side effects", async () => {
    const cookie = await signup(app, `approval-j-${stamp}@rakazo.test`, "Approval");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const recordsBefore = connector.records.length;

    const sent = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "write this to the destination crm as a note",
    });
    const waiting = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => snap.run?.status === "waiting_input",
    );
    expect(JSON.stringify(waiting.messages)).toMatch(/allow once|review before/i);
    expect(connector.records).toHaveLength(recordsBefore);
    await answerPendingApproval(app, cookie, bot.id, sent.runId, "allow", waiting);
    await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
    );
    expect(connector.records.length).toBeGreaterThan(recordsBefore);

    const task = await prisma.task.findFirstOrThrow({
      where: { runs: { some: { id: sent.runId } } },
    });
    expect(task.prompt).toBe("write this to the destination crm as a note");

    const recordsAfterAllow = connector.records.length;
    const second = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "write this to the destination crm as a note again",
    });
    const waitingAgain = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => snap.run?.status === "waiting_input",
    );
    await answerPendingApproval(app, cookie, bot.id, second.runId, "deny", waitingAgain);
    const denied = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
    );
    expect(connector.records).toHaveLength(recordsAfterAllow);
    expect(denied.run?.status ?? "completed").toBe("completed");
    const deniedEffect = await prisma.externalEffect.findFirst({
      where: { runId: second.runId, kind: "destination.write" },
    });
    expect(deniedEffect?.status).toBe("denied");
  });

  it("19b: stopping a run with an open approval card settles its effect", async () => {
    const cookie = await signup(app, `approval-stop-j-${stamp}@rakazo.test`, "ApprovalStop");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const sent = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "write this to the destination crm as a note",
    });
    await waitFor(app, cookie, bot.id, (snap) => snap.run?.status === "waiting_input");
    expect(
      (
        await prisma.externalEffect.findFirstOrThrow({
          where: { runId: sent.runId, kind: "destination.write" },
        })
      ).status,
    ).toBe("intended");

    await rpc(app, cookie, "threads/stop", { botId: bot.id });

    const effect = await prisma.externalEffect.findFirstOrThrow({
      where: { runId: sent.runId, kind: "destination.write" },
    });
    expect(effect.status).toBe("denied");
  });

  it("20: always allow runs a tool without a card, and a block refuses it in every mode", async () => {
    const cookie = await signup(app, `always-j-${stamp}@rakazo.test`, "Always");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const recordsBefore = connector.records.length;

    const first = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "write this to the destination crm as a note",
    });
    const waiting = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => snap.run?.status === "waiting_input",
    );
    await answerPendingApproval(app, cookie, bot.id, first.runId, "always", waiting);
    await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
    );
    expect(connector.records.length).toBe(recordsBefore + 1);

    await sendAndWait(app, cookie, bot.id, "write this to the destination crm once more");
    expect(connector.records.length).toBe(recordsBefore + 2);

    await rpc(app, cookie, "approvalRules/set", {
      effect: "deny",
      matchKind: "tool",
      matchValue: "destination.write",
    });
    for (const mode of ["ask", "never"]) {
      await rpc(app, cookie, "autoReview/set", { mode });
      const blocked = await sendAndWait(
        app,
        cookie,
        bot.id,
        `write this to the destination crm while it is blocked in ${mode}`,
      );
      expect(blocked.run.status).toBe("completed");
      expect(connector.records.length).toBe(recordsBefore + 2);
    }
  });

  it("20b: allowing a tool replaces its block, and the other way around", async () => {
    const cookie = await signup(app, `always-replaces-j-${stamp}@rakazo.test`, "Always Replaces");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const rule = { matchKind: "tool", matchValue: "destination.write" };
    const effects = async () =>
      (await rpc<Array<{ effect: string; matchValue: string }>>(app, cookie, "approvalRules/list"))
        .filter((row) => row.matchValue.toLowerCase() === rule.matchValue)
        .map((row) => row.effect);
    // Rules match tool names whatever their case, so the replacement must too.
    await rpc(app, cookie, "approvalRules/set", {
      effect: "deny",
      matchKind: "tool",
      matchValue: "Destination.Write",
    });
    await rpc(app, cookie, "approvalRules/set", { effect: "always_allow", ...rule });
    expect(await effects()).toEqual(["always_allow"]);

    const recordsBefore = connector.records.length;
    await sendAndWait(app, cookie, bot.id, "write this to the destination crm once more");
    expect(connector.records.length).toBe(recordsBefore + 1);

    await rpc(app, cookie, "approvalRules/set", { effect: "deny", ...rule });
    expect(await effects()).toEqual(["deny"]);
  });

  it("20c: allow and block saved at once leave one rule per match", async () => {
    const cookie = await signup(app, `rule-race-j-${stamp}@rakazo.test`, "Rule Race");
    const values = Array.from({ length: 8 }, (_, index) => `race.tool.${index}`);
    await Promise.all(
      values.flatMap((matchValue) =>
        ["always_allow", "deny"].map((effect) =>
          rpc(app, cookie, "approvalRules/set", { effect, matchKind: "tool", matchValue }),
        ),
      ),
    );
    const rows = await rpc<Array<{ matchValue: string }>>(app, cookie, "approvalRules/list");
    expect(rows.map((row) => row.matchValue).sort()).toEqual(values);
  });

  it("20d: replacing a rule leaves tools with similar names alone", async () => {
    const cookie = await signup(app, `rule-literal-j-${stamp}@rakazo.test`, "Rule Literal");
    await rpc(app, cookie, "approvalRules/set", {
      effect: "always_allow",
      matchKind: "tool",
      matchValue: "toolXa",
    });
    await rpc(app, cookie, "approvalRules/set", {
      effect: "deny",
      matchKind: "tool",
      matchValue: "tool_a",
    });
    const rows = await rpc<Array<{ effect: string; matchValue: string }>>(
      app,
      cookie,
      "approvalRules/list",
    );
    expect(rows.map((row) => `${row.effect}:${row.matchValue}`).sort()).toEqual([
      "always_allow:toolXa",
      "deny:tool_a",
    ]);
  });

  it("20e: always allowing a paid request's site stops asking for that site, and only that site", async () => {
    const cookie = await signup(app, `always-site-j-${stamp}@rakazo.test`, "Always Site");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const first = await rpc<{ runId: string }>(app, cookie, "threads/send", {
      botId: bot.id,
      text: "show a paid request card",
    });
    const waiting = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => snap.run?.status === "waiting_input",
    );
    expect(JSON.stringify(waiting.messages)).toContain("Always allow example.test");
    await answerPendingApproval(app, cookie, bot.id, first.runId, "always", waiting);
    await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
    );
    // A new run, so nothing approved in the first one carries over.
    await sendAndWait(app, cookie, bot.id, "show a paid request card again");
    expect(
      (
        await rpc<Array<{ effect: string; matchKind: string; matchValue: string }>>(
          app,
          cookie,
          "approvalRules/list",
        )
      ).map(({ effect, matchKind, matchValue }) => ({ effect, matchKind, matchValue })),
    ).toEqual([{ effect: "always_allow", matchKind: "site", matchValue: "example.test" }]);

    await rpc(app, cookie, "threads/send", {
      botId: bot.id,
      text: "show a paid request card on other",
    });
    await waitFor(app, cookie, bot.id, (snap) => snap.run?.status === "waiting_input");
  });

  it("21: in Ask mode, routine destination writes pause on the same approval card", async () => {
    const cookie = await signup(app, `routine-approval-j-${stamp}@rakazo.test`, "Routine Approval");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Chief",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const routine = await rpc<{ id: string }>(app, cookie, "routines/create", {
      botId: bot.id,
      name: "Send note",
      prompt: "write this to the destination crm as a note",
      crons: ["0 9 * * 1"],
      timezone: "UTC",
      notify: false,
      active: false,
    });
    const recordsBefore = connector.records.length;
    const tested = await rpc<{ runId: string }>(app, cookie, "routines/testRun", {
      routineId: routine.id,
    });
    const waiting = await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => snap.run?.status === "waiting_input",
    );
    expect(connector.records).toHaveLength(recordsBefore);
    await answerPendingApproval(app, cookie, bot.id, tested.runId, "allow", waiting);
    await waitFor(
      app,
      cookie,
      bot.id,
      (snap) => !snap.run || ["completed", "failed", "cancelled"].includes(snap.run.status),
    );
    expect(connector.records.length).toBeGreaterThan(recordsBefore);
  });

  it("22: a routine schedule with any malformed or mixed one-shot cron is rejected", async () => {
    const cookie = await signup(app, `routine-crons-j-${stamp}@rakazo.test`, "Routine Crons");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Scheduler",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const partiallyInvalid = await raw(app, cookie, "routines/create", {
      botId: bot.id,
      name: "Bad schedule",
      prompt: "check the fixture",
      crons: ["0 9 * * *", "not-a-cron"],
      timezone: "UTC",
      notify: false,
      active: true,
    });
    expect(partiallyInvalid.status).toBeGreaterThanOrEqual(400);
    const mixedOneShot = await raw(app, cookie, "routines/create", {
      botId: bot.id,
      name: "Mixed schedule",
      prompt: "check the fixture",
      crons: ["@once", "0 9 * * *"],
      timezone: "UTC",
      notify: false,
      active: false,
    });
    expect(mixedOneShot.status).toBeGreaterThanOrEqual(400);
  });

  it("routine timezone writes reject invalid zones without changing persisted schedules", async () => {
    const cookie = await signup(app, `routine-zones-j-${stamp}@rakazo.test`, "Routine Zones");
    const bot = await rpc<Bot>(app, cookie, "bots/create", { name: "Scheduler" });
    const input = {
      botId: bot.id,
      name: "Daily",
      prompt: "Check",
      crons: ["0 9 * * *"],
      active: false,
    };
    for (const timezone of ["Mars/Olympus_Mons", "", "+01:00"]) {
      const response = await raw(app, cookie, "routines/create", { ...input, timezone });
      expect.soft(response.status).toBe(400);
    }
    expect.soft(await prisma.routine.count({ where: { botId: bot.id } })).toBe(0);
    const routine = await rpc<{ id: string; timezone: string }>(
      app,
      cookie,
      "routines/create",
      input,
    );
    expect(routine.timezone).toBe("UTC");
    const before = await prisma.routine.findUniqueOrThrow({ where: { id: routine.id } });
    for (const timezone of ["Mars/Olympus_Mons", "", "+01:00"]) {
      const response = await raw(app, cookie, "routines/update", {
        routineId: routine.id,
        timezone,
        name: "Changed",
      });
      expect.soft(response.status).toBe(400);
      expect
        .soft(await prisma.routine.findUniqueOrThrow({ where: { id: routine.id } }))
        .toEqual(before);
    }
    for (const timezone of ["Pacific/Auckland", "UTC"]) {
      const created = await rpc<{ id: string; timezone: string }>(app, cookie, "routines/create", {
        ...input,
        timezone,
      });
      expect(created.timezone).toBe(timezone);
      const updated = await rpc<{ timezone: string }>(app, cookie, "routines/update", {
        routineId: routine.id,
        timezone,
      });
      expect(updated.timezone).toBe(timezone);
      expect((await prisma.routine.findUniqueOrThrow({ where: { id: routine.id } })).timezone).toBe(
        timezone,
      );
    }
    const renamed = await rpc<{ timezone: string }>(app, cookie, "routines/update", {
      routineId: routine.id,
      name: "Renamed",
    });
    expect(renamed.timezone).toBe("UTC");
  });

  it("23: never-run one-shot templates can be armed with a future runAt", async () => {
    const cookie = await signup(app, `once-arm-j-${stamp}@rakazo.test`, "Once Arm");
    const me = await rpc<Me>(app, cookie, "me");
    const bot = await rpc<Bot>(app, cookie, "bots/create", {
      name: "Once Bot",
      title: "",
      instructions: "",
      notifyOnFinish: true,
    });
    const routine = await prisma.routine.create({
      data: {
        spaceId: me.spaceId,
        userId: me.userId,
        botId: bot.id,
        name: "Remind once",
        prompt: "Ping me once",
        crons: ["@once"],
        timezone: "UTC",
        notify: true,
        active: false,
        nextRunAt: null,
      },
    });

    const withoutTime = await raw(app, cookie, "routines/update", {
      routineId: routine.id,
      active: true,
    });
    expect(withoutTime.status).toBeGreaterThanOrEqual(400);

    const runAt = new Date(Date.now() + 120_000).toISOString();
    const armed = await rpc<{ active: boolean; nextRunAt: string | null }>(
      app,
      cookie,
      "routines/update",
      {
        routineId: routine.id,
        active: true,
        runAt,
      },
    );
    expect(armed.active).toBe(true);
    expect(armed.nextRunAt).toBe(runAt);

    await prisma.routine.update({
      where: { id: routine.id },
      data: { active: false, nextRunAt: null, lastRunAt: new Date() },
    });
    const afterFire = await raw(app, cookie, "routines/update", {
      routineId: routine.id,
      active: true,
      runAt: new Date(Date.now() + 180_000).toISOString(),
    });
    expect(afterFire.status).toBeGreaterThanOrEqual(400);

    await prisma.routine.update({
      where: { id: routine.id },
      data: { active: false, nextRunAt: null, lastRunAt: null },
    });
    await rpc(app, cookie, "bots/archive", { botId: bot.id });
    const whileArchived = await raw(app, cookie, "routines/update", {
      routineId: routine.id,
      active: true,
      runAt: new Date(Date.now() + 180_000).toISOString(),
    });
    expect(whileArchived.status).toBe(404);
    await expect(
      prisma.routine.findUniqueOrThrow({ where: { id: routine.id } }),
    ).resolves.toMatchObject({ active: false, nextRunAt: null });

    // A routine that is somehow active on an archived bot is re-paused, not run.
    const dueAt = new Date(Date.now() - 1_000);
    await prisma.routine.update({
      where: { id: routine.id },
      data: { active: true, nextRunAt: dueAt },
    });
    await runAsSystem("background job routine.wakeup", () =>
      executor.wakeRoutine(routine.id, dueAt.toISOString()),
    );
    await expect(
      prisma.routine.findUniqueOrThrow({ where: { id: routine.id } }),
    ).resolves.toMatchObject({ active: false, nextRunAt: null, lastRunAt: null });
    await expect(prisma.run.count({ where: { routineId: routine.id } })).resolves.toBe(0);
  });
});

type Me = { spaceId: string; userId: string; canChooseHostComputer: boolean };
type Bot = {
  id: string;
  spaceId: string;
  name: string;
  title: string;
  description: string;
  instructions: string;
  notifyOnFinish: boolean;
  color: string;
  pinned: boolean;
  sectionId: string | null;
  unread: boolean;
  computerMode: "team" | "dedicated";
};
type Snap = {
  messages: Array<{
    id: string;
    seq: number;
    runId?: string | null;
    blocks: Array<{
      kind?: string;
      status?: string;
      answer?: string;
      text?: string;
      actions?: unknown[];
    }>;
  }>;
  run: { id: string; status: string } | null;
  activeRuns?: Array<{ id: string; status: string }>;
};

async function signup(app: App, email: string, name: string) {
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify({ email, password: "password12", name }),
  });
  if (res.status >= 400) {
    throw new Error(`signup failed ${res.status}: ${await res.text()}`);
  }
  return sessionCookieHeader(res);
}

async function raw(app: App, cookie: string, proc: string, body: unknown = {}) {
  return app.request(`/rpc/${proc}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify({ json: body }),
  });
}

async function rpc<T>(app: App, cookie: string, proc: string, body: unknown = {}): Promise<T> {
  const res = await raw(app, cookie, proc, body);
  const text = await res.text();
  let parsed: { json?: T; error?: { message?: string } };
  try {
    parsed = JSON.parse(text) as { json?: T; error?: { message?: string } };
  } catch {
    throw new Error(`${proc} ${res.status}: ${text}`);
  }
  if (res.status >= 400 || parsed.error) {
    throw new Error(`${proc} ${res.status}: ${parsed.error?.message ?? text}`);
  }
  return parsed.json as T;
}

async function answerPendingApproval(
  app: App,
  cookie: string,
  botId: string,
  runId: string,
  answer: "allow" | "always" | "deny",
  current?: Snap,
) {
  const waiting =
    current ??
    (await waitFor(
      app,
      cookie,
      botId,
      (snap) => snap.run?.id === runId && snap.run.status === "waiting_input",
    ));
  const message = [...waiting.messages]
    .reverse()
    .find(
      (candidate) =>
        candidate.runId === runId &&
        candidate.blocks.some(
          (block) =>
            typeof block === "object" &&
            block !== null &&
            "kind" in block &&
            block.kind === "ask" &&
            "approvalEffectId" in block &&
            typeof block.approvalEffectId === "string" &&
            "actions" in block &&
            Array.isArray(block.actions),
        ),
    );
  if (!message) throw new Error(`run ${runId} did not expose an approval card`);
  await rpc(app, cookie, "threads/answer", {
    botId,
    runId,
    messageId: message.id,
    answer,
  });
}

async function waitFor(app: App, cookie: string, botId: string, pred: (snap: Snap) => boolean) {
  const start = Date.now();
  let last: Snap | null = null;
  while (Date.now() - start < 20_000) {
    last = await rpc<Snap>(app, cookie, "threads/get", { botId });
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for thread: ${JSON.stringify(last)}`);
}

async function waitForDatabase(pred: () => Promise<boolean>) {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    if (await pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timeout waiting for database state");
}
