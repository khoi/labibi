import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoutineWatchSchema } from "@labradoodle/contracts";
import { describe, expect, it, vi } from "vitest";
import type { fakeDatabase } from "./bot-secrets.test-support.js";
import { provisionComputer } from "./computer-lifecycle.js";
import type { RoutineWatchTickDeps } from "./routine-watch.js";
import {
  checkRoutineWatch,
  compareReading,
  describeEntryChanges,
  FILES_SCRIPT,
  parseRoutineWatch,
  readItems,
  stableStringify,
  tickRoutineWatch,
  toolResultText,
  validateRoutineWatch,
} from "./routine-watch.js";

vi.mock("./computer-lifecycle.js", async (original) => ({
  ...(await original()),
  provisionComputer: vi.fn(),
}));
vi.mock("./computer-idle.js", () => ({ scheduleComputerSleep: vi.fn() }));

const NOW = new Date("2026-10-16T12:00:00.000Z");

describe("RoutineWatchSchema", () => {
  it("defaults to every 15 minutes, quiet", () => {
    const watch = RoutineWatchSchema.parse({ kind: "files", paths: ["inbox"] });
    expect(watch).toMatchObject({ everyMinutes: 15, loud: false });
  });

  it("needs the field its kind uses", () => {
    expect(RoutineWatchSchema.safeParse({ kind: "files" }).success).toBe(false);
    expect(RoutineWatchSchema.safeParse({ kind: "command" }).success).toBe(false);
    expect(RoutineWatchSchema.safeParse({ kind: "tool" }).success).toBe(false);
  });

  it("keeps integration checks to at most every 5 minutes", () => {
    const fast = { kind: "tool", tool: "brain_changed", everyMinutes: 1 };
    expect(RoutineWatchSchema.safeParse(fast).success).toBe(false);
    expect(RoutineWatchSchema.safeParse({ ...fast, everyMinutes: 5 }).success).toBe(true);
  });

  it("tracks items by up to five fields, identity first", () => {
    const tool = { kind: "tool", tool: "list_tasks", track: ["id", "date_updated"] };
    expect(RoutineWatchSchema.parse(tool).track).toEqual(["id", "date_updated"]);
    expect(RoutineWatchSchema.safeParse({ ...tool, track: [] }).success).toBe(false);
    expect(
      RoutineWatchSchema.safeParse({ kind: "files", paths: ["a"], track: ["id"] }).success,
    ).toBe(false);
  });

  it("reads an invalid stored watch as none rather than throwing", () => {
    expect(parseRoutineWatch({ kind: "nope" })).toBeNull();
    expect(parseRoutineWatch(null)).toBeNull();
  });
});

describe("compareReading", () => {
  const reading = { fingerprint: "b", detail: "new output" };

  it("records the first reading as a baseline and does not run", () => {
    expect(compareReading(null, reading, NOW)).toMatchObject({
      changed: false,
      state: { outcome: "baseline", fingerprint: "b" },
    });
  });

  it("does not run when the fingerprint is the same", () => {
    const previous = {
      checkedAt: "x",
      outcome: "unchanged" as const,
      fingerprint: "b",
      detail: null,
    };
    expect(compareReading(previous, reading, NOW)).toMatchObject({
      changed: false,
      state: { outcome: "unchanged" },
    });
  });

  it("runs, with the reading's detail, when it differs", () => {
    const previous = {
      checkedAt: "x",
      outcome: "unchanged" as const,
      fingerprint: "a",
      detail: null,
    };
    expect(compareReading(previous, reading, NOW)).toMatchObject({
      changed: true,
      state: { outcome: "changed", detail: "new output" },
    });
  });

  it("compares against the last good fingerprint after a failed check", () => {
    const failed = { checkedAt: "x", outcome: "failed" as const, fingerprint: "b", detail: "boom" };
    expect(compareReading(failed, reading, NOW).changed).toBe(false);
  });
});

describe("describeEntryChanges", () => {
  it("names what was added, edited and removed", () => {
    const text = describeEntryChanges(
      { "a.txt": "1:1", "b.txt": "1:1", "c.txt": "1:1" },
      { "a.txt": "1:1", "b.txt": "2:2", "d.txt": "1:1" },
    );
    expect(text).toBe("New: d.txt\nEdited: b.txt\nRemoved: c.txt");
  });
});

describe("stableStringify", () => {
  it("ignores key order", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
  });
});

describe("tickRoutineWatch", () => {
  const scheduledAt = new Date(Date.now() - 1_000);
  const target = { threadId: "thread-1", botId: "bot-1" };

  function setup(result: { data?: unknown; error?: string }, watch: Record<string, unknown> = {}) {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const messages: Array<{ role: string; blocks: unknown }> = [];
    const tx = {
      thread: { update: vi.fn(async () => ({ nextMessageSeq: 1, nextEventSeq: 1 })) },
      message: {
        create: vi.fn(async ({ data }: { data: { role: string; blocks: unknown } }) => {
          messages.push(data);
          return { id: "m1", ...data };
        }),
      },
      event: { create: vi.fn(async () => ({ seq: 1 })) },
    };
    const deps = {
      prisma: {
        routine: { updateMany },
        connection: { findMany: vi.fn(async () => []) },
        userActionApprovalRule: { findMany: vi.fn(async () => []) },
        bot: {
          findUnique: vi.fn(async () => ({
            id: "bot-1",
            computer: { id: "computer-1", scope: "team", kind: "vm" },
          })),
        },
        $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
      },
      events: { notify: vi.fn(async () => undefined) },
      jobs: { enqueue: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) },
      connector: {
        discoverTools: vi.fn(async () => [
          { name: "brain_changed", readOnly: true, route: { connectorId: "installed" } },
        ]),
        execute: vi.fn(async function* () {
          if (result.error) yield { type: "error", message: result.error };
          else yield { type: "result", data: result.data };
        }),
      },
    } as unknown as RoutineWatchTickDeps;
    const routine = {
      id: "routine-1",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
      name: "Brain check",
      watch: { kind: "tool", tool: "brain_changed", args: { limit: 1 }, ...watch },
      watchState: {
        checkedAt: "x",
        outcome: "unchanged",
        fingerprint: null as string | null,
        detail: null,
      },
    };
    return { deps, routine, updateMany, messages };
  }

  it("records a quiet no-change check without a message and schedules the next", async () => {
    const { deps, routine, updateMany, messages } = setup({ data: { changes: [] } });
    // First reading is the baseline.
    await tickRoutineWatch(deps, routine, target, scheduledAt);
    const baseline = (
      updateMany.mock.calls[0] as unknown as [
        { data: { watchState: { checkedAt: string; fingerprint: string } } },
      ]
    )[0].data.watchState;
    routine.watchState = { ...baseline, outcome: "unchanged", detail: null };

    const tick = await tickRoutineWatch(deps, routine, target, scheduledAt);
    expect(tick).toEqual({ run: false });
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          watchState: expect.objectContaining({ outcome: "unchanged" }),
        }),
      }),
    );
    expect(deps.jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(messages).toHaveLength(0);
  });

  it("saves a check only for the owner it started with", async () => {
    const { deps, routine, updateMany } = setup({ data: { changes: [] } });
    // Someone else taking the routine over mid-check makes this write miss.
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(tickRoutineWatch(deps, routine, target, scheduledAt)).resolves.toEqual({
      run: false,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: routine.id, userId: "user-1", active: true, nextRunAt: scheduledAt },
      }),
    );
  });

  it("posts 'no changes' when loud", async () => {
    const { deps, routine, updateMany, messages } = setup(
      { data: { changes: [] } },
      { loud: true },
    );
    await tickRoutineWatch(deps, routine, target, scheduledAt);
    const baseline = (
      updateMany.mock.calls[0] as unknown as [
        { data: { watchState: { checkedAt: string; fingerprint: string } } },
      ]
    )[0].data.watchState;
    routine.watchState = { ...baseline, outcome: "unchanged", detail: null };
    await tickRoutineWatch(deps, routine, target, scheduledAt);
    expect(messages.at(-1)).toMatchObject({
      role: "system",
      blocks: [{ kind: "meta", text: "Brain check routine: no changes" }],
    });
  });

  it.each([false, undefined])(
    "refuses a tool with readOnly %s without executing it",
    async (readOnly) => {
      const { deps, routine } = setup({ data: "ok" });
      vi.mocked(deps.connector!.discoverTools).mockResolvedValue([
        { name: "brain_changed", readOnly, description: "Read changes", inputSchema: {} },
      ]);
      await expect(checkRoutineWatch(deps, routine)).rejects.toThrow("can change data");
      expect(deps.connector!.execute).not.toHaveBeenCalled();
      await expect(
        validateRoutineWatch(deps, RoutineWatchSchema.parse(routine.watch), routine),
      ).rejects.toThrow("can change data");
    },
  );

  it("refuses a batch tool even when it is declared read-only", async () => {
    const { deps, routine } = setup({ data: "ok" });
    vi.mocked(deps.connector!.discoverTools).mockResolvedValue([
      {
        name: "brain_changed",
        readOnly: true,
        batch: { items: "tools", action: "tool_slug", arguments: "arguments" },
        description: "Run actions",
        inputSchema: {},
      },
    ]);
    await expect(checkRoutineWatch(deps, routine)).rejects.toThrow("can change data");
    expect(deps.connector!.execute).not.toHaveBeenCalled();
    await expect(
      validateRoutineWatch(deps, RoutineWatchSchema.parse(routine.watch), routine),
    ).rejects.toThrow("can change data");
  });

  it.each([false, undefined, true])("checks lazy tool readOnly %s", async (readOnly) => {
    const { deps, routine } = setup({ data: "ok" });
    vi.mocked(deps.connector!.discoverTools).mockResolvedValue([]);
    deps.connector!.resolveCall = vi.fn(async (call) => ({
      call,
      tool: { name: call.tool, readOnly, description: "Read changes", inputSchema: {} },
    }));
    if (readOnly)
      await expect(checkRoutineWatch(deps, routine)).resolves.toMatchObject({ changed: false });
    else await expect(checkRoutineWatch(deps, routine)).rejects.toThrow("can change data");
    expect(deps.connector!.execute).toHaveBeenCalledTimes(readOnly ? 1 : 0);
  });

  it("runs the tool call on a fresh time budget when discovery used up its own", async () => {
    const { deps, routine } = setup({ data: "ok" });
    const budgets: AbortController[] = [];
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const budget = new AbortController();
      budgets.push(budget);
      return budget.signal;
    });
    try {
      vi.mocked(deps.connector!.discoverTools).mockImplementation(async (ctx) => {
        budgets.find((budget) => budget.signal === ctx.signal)!.abort();
        return [{ name: "brain_changed", readOnly: true, description: "Read", inputSchema: {} }];
      });
      let callSignal: AbortSignal | undefined;
      vi.mocked(deps.connector!.execute).mockImplementation(async function* (_call, ctx) {
        callSignal = ctx.signal;
        yield { type: "result", data: "ok" };
      });
      await expect(checkRoutineWatch(deps, routine)).resolves.toMatchObject({ changed: false });
      expect(callSignal?.aborted).toBe(false);
    } finally {
      timeout.mockRestore();
    }
  });

  it.each([{ isError: true, content: [{ type: "text", text: "failed" }] }, { error: "failed" }])(
    "rejects error result envelopes",
    async (data) => {
      const { deps, routine } = setup({ data });
      await expect(checkRoutineWatch(deps, routine)).rejects.toThrow("failed");
    },
  );

  it("keeps the structured data in a change note beside supplemental text", async () => {
    // The duplicate text was dropped on the way in, so the reader must not let
    // the leftover note replace the data that triggered the routine.
    const { deps, routine } = setup({
      data: {
        content: [{ type: "text", text: "Query completed." }],
        structuredContent: { changes: [{ what: "add test note", at: "2026-11-01T09:30:00Z" }] },
        isError: false,
      },
    });
    routine.watchState = { checkedAt: "x", outcome: "unchanged", fingerprint: "old", detail: null };
    const result = await checkRoutineWatch(deps, routine);
    expect(result.state.detail).toContain("Query completed.");
    expect(result.state.detail).toContain("add test note");
  });

  it("applies approval rules to the real tool behind a lazy catalog call", async () => {
    const { deps, routine } = setup({ data: "ok" });
    vi.mocked(deps.connector!.discoverTools).mockResolvedValue([]);
    deps.connector!.resolveCall = vi.fn(async (call) => ({
      call,
      tool: { name: "actual_read", readOnly: true, description: "Read", inputSchema: {} },
    }));
    vi.mocked(deps.prisma.userActionApprovalRule.findMany).mockResolvedValue([
      { effect: "require_approval", matchKind: "tool", matchValue: "actual_read" },
    ] as never);
    await expect(checkRoutineWatch(deps, routine)).rejects.toThrow("needs approval");
    expect(deps.connector!.execute).not.toHaveBeenCalled();
  });

  it("runs with a note of what changed", async () => {
    const { deps, routine } = setup({ data: { changes: [{ path: "Facts/new.md" }] } });
    routine.watchState.fingerprint = "old";
    const tick = await tickRoutineWatch(deps, routine, target, scheduledAt);
    expect(tick.run).toBe(true);
    if (!tick.run) return;
    expect(tick.note).toContain("What changed since the last check");
    expect(tick.note).toContain("Facts/new.md");
    expect(tick.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });
});

describe("tool results", () => {
  it.each([
    [
      "its text",
      { content: [{ type: "text", text: "limit must be a number" }], isError: true },
      /limit must be a number/,
    ],
    [
      "structured diagnostics when the text is blank",
      {
        content: [{ type: "text", text: "" }],
        structuredContent: { error: "Permission denied" },
        isError: true,
      },
      /Permission denied/,
    ],
    [
      "structured diagnostics the short text does not repeat",
      {
        content: [{ type: "text", text: "Request failed" }],
        structuredContent: { error: "Permission denied", requiredScope: "reports:read" },
        isError: true,
      },
      /Request failed[\s\S]*reports:read/,
    ],
    [
      "a numeric diagnostic whose digits happen to appear in the text",
      {
        content: [{ type: "text", text: "Service returned HTTP 503" }],
        structuredContent: { error: "Service returned HTTP 503", retryAfterSeconds: 3 },
        isError: true,
      },
      /retryAfterSeconds/,
    ],
    [
      "a text diagnostic whose value happens to appear in the text",
      {
        content: [{ type: "text", text: "Permission denied while reading repository" }],
        structuredContent: {
          error: "Permission denied while reading repository",
          requiredScope: "repo",
        },
        isError: true,
      },
      /requiredScope/,
    ],
  ])(
    "treats an MCP error result as a failed check that reports %s",
    async (_case, data, reported) => {
      const deps = {
        prisma: {
          connection: { findMany: vi.fn(async () => []) },
          userActionApprovalRule: { findMany: vi.fn(async () => []) },
        },
        connector: {
          discoverTools: vi.fn(async () => [
            { name: "brain_changed", readOnly: true, route: { connectorId: "installed" } },
          ]),
          execute: vi.fn(async function* () {
            yield { type: "result", data };
          }),
        },
      } as unknown as RoutineWatchTickDeps;
      const routine = {
        id: "r",
        spaceId: "s",
        userId: "u",
        botId: "b",
        watch: { kind: "tool", tool: "brain_changed", args: {} },
        watchState: null,
      };
      await expect(checkRoutineWatch(deps, routine)).rejects.toThrow(reported);
    },
  );
});

describe("tickRoutineWatch on a computer", () => {
  const scheduledAt = new Date(Date.now() - 1_000);
  const target = { threadId: "thread-1", botId: "bot-1" };

  function setupComputer(
    watch: Record<string, unknown>,
    exec: { stdout?: string; stderr?: string; code?: number } = {},
    computer = { id: "computer-1", scope: "team", kind: "vm" },
    options?: {
      vault?: ReturnType<typeof fakeDatabase>;
      secretStore?: { load(ciphertext: string, recordId: string): Promise<string> };
      shell?: { platform: string; shell: string; home: string };
    },
  ) {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const messages: unknown[] = [];
    const tx = {
      thread: { update: vi.fn(async () => ({ nextMessageSeq: 1, nextEventSeq: 1 })) },
      message: {
        create: vi.fn(async ({ data }: { data: unknown }) => {
          messages.push(data);
          return { id: "m1", ...(data as object) };
        }),
      },
      event: { create: vi.fn(async () => ({ seq: 1 })) },
    };
    const execute = vi.fn(async function* () {
      if (exec.stdout) yield { type: "stdout", data: exec.stdout };
      if (exec.stderr) yield { type: "stderr", data: exec.stderr };
      yield { type: "exit", code: exec.code ?? 0 };
    });
    const environment = options?.shell ? vi.fn(async () => options.shell) : undefined;
    const deps = {
      prisma: {
        routine: { updateMany },
        bot: {
          findUnique: vi.fn(async () => ({
            id: "bot-1",
            computer,
          })),
        },
        $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
        ...(options?.vault
          ? {
              vaultCredential: options.vault.prisma.vaultCredential,
            }
          : {}),
      },
      ...(options?.secretStore ? { secretStore: options.secretStore } : {}),
      sandbox: {
        execute,
        describe: () => ({ capabilities: { graphical: true } }),
        ...(environment ? { environment } : {}),
      },
      events: { notify: vi.fn(async () => undefined) },
      jobs: { enqueue: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) },
      commandRefusal: (command: string) =>
        command.includes("pkill") ? "protected command pkill" : undefined,
    } as unknown as RoutineWatchTickDeps;
    const routine = {
      id: "routine-1",
      spaceId: "space-1",
      userId: "user-1",
      botId: "bot-1",
      name: "Inbox watch",
      watch,
      watchState: { checkedAt: "x", outcome: "unchanged", fingerprint: "old", detail: null },
    };
    return { deps, routine, updateMany, messages, execute, environment };
  }

  it("refuses a command the desktop-protection guard refuses, without running it", async () => {
    vi.mocked(provisionComputer).mockResolvedValueOnce({
      id: "computer-1",
      botId: "bot-1",
      kind: "fake",
      providerRef: "fake",
    });
    const { deps, routine, updateMany, execute } = setupComputer({
      kind: "command",
      command: "pkill chrome; ls",
    });
    await tickRoutineWatch(deps, routine, target, scheduledAt);
    expect(execute).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ active: false }) }),
    );
  });
});

describe("toolResultText", () => {
  // The shape the VEC brain's brain_changed returned live through an installed MCP server.
  const envelope = {
    content: [{ type: "text", text: '{\n  "changes": [{"what": "add test note"}]\n}' }],
    isError: false,
  };

  it("unwraps an MCP result to its text", () => {
    expect(toolResultText(envelope)).toBe('{\n  "changes": [{"what": "add test note"}]\n}');
  });

  it("joins several text parts and skips non-text ones", () => {
    expect(
      toolResultText({
        content: [
          { type: "text", text: "one" },
          { type: "image", data: "…" },
          { type: "text", text: "two" },
        ],
      }),
    ).toBe("one\ntwo");
  });

  it("keeps an error result's text alone instead of repeating its structured copy", () => {
    expect(
      toolResultText({
        content: [{ type: "text", text: "Permission denied for folder Reports" }],
        structuredContent: { error: "Permission denied for folder Reports" },
        isError: true,
      }),
    ).toBe("Permission denied for folder Reports");
  });

  it("keeps plain strings and other data readable", () => {
    expect(toolResultText("plain")).toBe("plain");
    expect(toolResultText({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("files listing script", () => {
  it("resolves a relative team root in the provider's working directory", () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "routine-watch-")));
    try {
      mkdirSync(join(folder, "inbox"));
      // Keep the containment check real; emulate GNU find on hosts with BSD find.
      const script = `find() { printf 'inbox/note.txt\\t3\\t1.25\\n'; }\n${FILES_SCRIPT}`;
      const result = spawnSync("sh", ["-c", script, "watch", ".", "inbox"], {
        cwd: folder,
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("inbox/note.txt\t3\t1.25\n");
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it("refuses a symlink that points outside the bot folder before listing", () => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), "routine-watch-")));
    try {
      const folder = join(temp, "bot");
      mkdirSync(folder);
      const outside = join(temp, "outside");
      mkdirSync(outside);
      writeFileSync(join(outside, "private.txt"), "fixture");
      const link = join(folder, "link");
      symlinkSync(outside, link);
      for (const path of [link, join(link, "private.txt")]) {
        const result = spawnSync("sh", ["-c", FILES_SCRIPT, "watch", folder, path], {
          encoding: "utf8",
        });
        expect(result.status).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Path escapes the bot folder");
      }
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it("keeps an earlier listing failure and its stderr when the last path succeeds", () => {
    // Simulate a sandbox where one find fails, followed by a successful listing.
    const script = `find() { if [ "$2" = / ]; then echo denied >&2; return 1; fi; printf 'ok\\t1\\t1.234\\n'; }\n${FILES_SCRIPT}`;
    const result = spawnSync("sh", ["-c", script, "watch", "", "/", "/."], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("denied");
    expect(result.stdout).toContain("1.234");
  });
});

describe("readItems", () => {
  it("prefers MCP structured results over display text", () => {
    const reading = readItems(
      {
        structuredContent: { items: [{ id: "item-1", version: 2 }] },
        content: [{ type: "text", text: "One item is available." }],
      },
      ["id", "version"],
    );
    expect(reading).toEqual(readItems([{ id: "item-1", version: 2 }], ["id", "version"]));
  });

  it("reads every JSON text block of an unstructured MCP result", () => {
    const items = [
      { id: "item-1", version: 1 },
      { id: "item-2", version: 2 },
    ];
    const reading = readItems(
      { content: items.map((item) => ({ type: "text", text: JSON.stringify(item) })) },
      ["id", "version"],
    );
    expect(reading).toEqual(readItems(items, ["id", "version"]));
  });

  it("reads an empty structured result with no text blocks", () => {
    expect(readItems({ structuredContent: { result: [] }, content: [] }, ["id"]).entries).toEqual(
      {},
    );
  });

  it("keeps support for a JSON document split across text blocks", () => {
    const reading = readItems(
      {
        content: [
          { type: "text", text: '{"items":' },
          { type: "text", text: '[{"id":"item-1"}]}' },
        ],
      },
      ["id"],
    );
    expect(reading).toEqual(readItems([{ id: "item-1" }], ["id"]));
  });

  it("does not silently drop an invalid text block beside a valid item", () => {
    expect(() =>
      readItems(
        {
          content: [
            { type: "text", text: '{"id":"item-1"}' },
            { type: "text", text: "not JSON" },
          ],
        },
        ["id"],
      ),
    ).toThrow("The result is not JSON");
  });

  it("falls back to JSON text when structuredContent is not an object", () => {
    expect(
      readItems(
        { structuredContent: "invalid", content: [{ type: "text", text: '{"id":"item-1"}' }] },
        ["id"],
      ),
    ).toEqual(readItems([{ id: "item-1" }], ["id"]));
  });

  const inbox = (messages: unknown[]) => ({
    content: [{ type: "text", text: JSON.stringify({ fetchedAt: Date.now(), messages }) }],
  });

  it("ignores everything outside the tracked fields", () => {
    const first = readItems(inbox([{ id: "m1", subject: "Invoice", snippet: "a" }]), ["id"]);
    const again = readItems(inbox([{ id: "m1", subject: "Invoice", snippet: "b" }]), ["id"]);
    expect(first.fingerprint).toBe(again.fingerprint);
  });

  it("names new, updated and gone items by their title", () => {
    const before = readItems(
      [
        { id: "t1", name: "Write rate card", date_updated: "1" },
        { id: "t2", name: "Call printer", date_updated: "1" },
      ],
      ["id", "date_updated"],
    );
    const after = readItems(
      [
        { id: "t1", name: "Write rate card", date_updated: "2" },
        { id: "t3", name: "Book venue", date_updated: "1" },
      ],
      ["id", "date_updated"],
    );
    const previous = {
      checkedAt: "x",
      outcome: "unchanged" as const,
      fingerprint: before.fingerprint,
      entries: before.entries,
      detail: null,
    };
    expect(compareReading(previous, after, NOW).state.detail).toBe(
      "New: Book venue\nUpdated: Write rate card\nGone: Call printer",
    );
  });

  it("finds items nested anywhere in the result", () => {
    const reading = readItems({ data: { files: [{ id: "f1", name: "Rates.pdf" }] } }, ["id"]);
    expect(Object.keys(reading.entries ?? {})).toEqual(["f1"]);
  });

  it("treats an empty list as no items, not a failure", () => {
    expect(readItems(inbox([]), ["id"]).entries).toEqual({});
  });
});

describe("watch tool guard", () => {
  function setupTool(
    tool: { name: string; readOnly?: boolean },
    args: Record<string, unknown>,
    rules: unknown[] = [],
  ) {
    const execute = vi.fn(async function* () {
      yield { type: "result", data: [] };
    });
    const deps = {
      prisma: {
        connection: { findMany: vi.fn(async () => []) },
        userActionApprovalRule: { findMany: vi.fn(async () => rules) },
      },
      connector: {
        discoverTools: vi.fn(async () => [{ ...tool, route: { connectorId: "installed" } }]),
        execute,
      },
    } as unknown as RoutineWatchTickDeps;
    const routine = {
      id: "r",
      spaceId: "s",
      userId: "u",
      botId: "b",
      watch: { kind: "tool", tool: tool.name, args },
      watchState: null,
    };
    return { deps, routine, execute };
  }

  it("refuses a tool that changes things, without calling it", async () => {
    const { deps, routine, execute } = setupTool({ name: "send_email" }, {});
    await expect(checkRoutineWatch(deps, routine)).rejects.toThrow(/can change data/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a write action on a tool that takes one", async () => {
    const { deps, routine, execute } = setupTool({ name: "clickbot_tasks" }, { action: "delete" });
    await expect(checkRoutineWatch(deps, routine)).rejects.toThrow(/can change data/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a tool that does not say it only reads, like brain_propose", async () => {
    const { deps, routine, execute } = setupTool({ name: "brain_propose" }, {});
    await expect(checkRoutineWatch(deps, routine)).rejects.toThrow(/can change data/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a read this space's rules ask approval for", async () => {
    const { deps, routine, execute } = setupTool({ name: "brain_search", readOnly: true }, {}, [
      { effect: "require_approval", matchKind: "tool", matchValue: "brain_search" },
    ]);
    await expect(checkRoutineWatch(deps, routine)).rejects.toThrow(/approval/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a tool its integration declares as a write", async () => {
    const { deps, routine } = setupTool({ name: "brain_changed", readOnly: false }, {});
    await expect(checkRoutineWatch(deps, routine)).rejects.toThrow(/can change data/);
  });

  it("allows reads, including tools whose name does not say", async () => {
    for (const [name, args] of [
      ["brain_changed", {}],
      ["clickbot_tasks", { action: "list" }],
      ["search_threads", { query: "invoice" }],
    ] as const) {
      const { deps, routine } = setupTool({ name, readOnly: true }, args);
      await expect(checkRoutineWatch(deps, routine)).resolves.toMatchObject({ changed: false });
    }
  });
});

describe("tracked result regressions", () => {
  it("compares only tracked fields while retaining titles for notes", () => {
    const before = readItems([{ id: "m1", subject: "Before", snippet: "a" }], ["id"]);
    const after = readItems([{ id: "m1", subject: "After", snippet: "b" }], ["id"]);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.entries).not.toEqual(before.entries);
  });
  it("fingerprints every item and ignores ordering beyond the detail limit", () => {
    const list = Array.from({ length: 2001 }, (_, i) => ({ id: String(i), modifiedTime: "1" }));
    const before = readItems(list, ["id", "modifiedTime"]);
    expect(before.entries).toBeUndefined();
    expect(readItems([...list].reverse(), ["id", "modifiedTime"]).fingerprint).toBe(
      before.fingerprint,
    );
    list[2000]!.modifiedTime = "2";
    expect(readItems(list, ["id", "modifiedTime"]).fingerprint).not.toBe(before.fingerprint);
  });
  it("includes children even when their parent has an identity", () => {
    const before = readItems({ id: "folder", files: [{ id: "file", modifiedTime: "1" }] }, [
      "id",
      "modifiedTime",
    ]);
    const after = readItems({ id: "folder", files: [{ id: "file", modifiedTime: "2" }] }, [
      "id",
      "modifiedTime",
    ]);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });
  it("keeps readable names and item wording when the last item disappears", () => {
    const before = readItems([{ id: "t1", name: "Call printer" }], ["id"]);
    expect(describeEntryChanges(before.entries!, {})).toBe("Gone: Call printer");
  });
});

it("loads authorized connection context for discovery, creation validation and connector rules", async () => {
  const connection = {
    id: "connection-1",
    connectorId: "pipedream",
    provider: "google_drive",
    providerRef: "fake-account",
    displayName: "Drive",
    status: "connected",
  };
  const discoverTools = vi.fn(async () => [
    { name: "google_drive_list_files", readOnly: true, description: "List", inputSchema: {} },
  ]);
  const rules: unknown[] = [];
  const execute = vi.fn(async function* () {
    yield { type: "result", data: [] };
  });
  const deps = {
    prisma: {
      connection: {
        findMany: vi.fn(async () => [
          connection,
          { ...connection, id: "revoked", status: "revoked" },
        ]),
      },
      userActionApprovalRule: { findMany: vi.fn(async () => rules) },
    },
    connector: { discoverTools, execute },
  } as unknown as RoutineWatchTickDeps;
  const routine = {
    id: "r",
    spaceId: "s",
    userId: "u",
    botId: "b",
    watch: { kind: "tool", tool: "google_drive_list_files" },
    watchState: null,
  };
  await checkRoutineWatch(deps, routine);
  await validateRoutineWatch(deps, RoutineWatchSchema.parse(routine.watch), routine);
  expect(discoverTools).toHaveBeenCalledTimes(2);
  for (const call of vi.mocked(deps.connector!.discoverTools).mock.calls) {
    expect(call[0]).toMatchObject({
      connectedConnections: [
        {
          id: "connection-1",
          connectorId: "pipedream",
          externalId: "google_drive",
          providerRef: "fake-account",
        },
      ],
      connectedProviders: [],
    });
  }
  rules.push({ effect: "require_approval", matchKind: "connector", matchValue: "google_drive" });
  await expect(checkRoutineWatch(deps, routine)).rejects.toThrow("needs approval");
  expect(execute).toHaveBeenCalledOnce();
});

describe("overlapping tracked identities", () => {
  it("retains parent values when a nested object has the same ID", () => {
    const result = (modifiedTime: string) => ({
      id: "1",
      modifiedTime,
      owner: { id: "1", name: "Owner" },
    });
    expect(readItems(result("1"), ["id", "modifiedTime"]).fingerprint).not.toBe(
      readItems(result("2"), ["id", "modifiedTime"]).fingerprint,
    );
  });
  it("keeps all duplicate-ID values and ignores their ordering", () => {
    const list = [
      { id: "1", modifiedTime: "1" },
      { id: "1", modifiedTime: "2" },
    ];
    const before = readItems(list, ["id", "modifiedTime"]);
    expect(readItems([...list].reverse(), ["id", "modifiedTime"]).fingerprint).toBe(
      before.fingerprint,
    );
    expect(readItems([list[0]], ["id", "modifiedTime"]).fingerprint).not.toBe(before.fingerprint);
  });
});
