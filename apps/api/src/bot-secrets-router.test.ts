import type { Actor } from "@labradoodle/contracts";
import { encodeLoginSecret } from "@labradoodle/contracts";
import type { PrismaClient } from "@labradoodle/db";
import { RPCHandler } from "@orpc/server/fetch";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

const events = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@labradoodle/db", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  recordSecurityEvent: events.record,
}));

// Offline boundary: a fake Prisma client and secret store drive the real router handlers,
// the real repos.getBot ownership check, and the real storeBotSecret validation.

type Row = Record<string, unknown>;

const actor = {
  spaceId: "space-1",
  userId: "user-1",
  email: "user@rakazo.test",
  isDeploymentOwner: true,
} satisfies Actor;

const FAKE_VALUE = "fake-value-SENTINEL-1";

function matches(row: Row, where: Row = {}) {
  return Object.entries(where).every(([key, value]) =>
    value && typeof value === "object" && "startsWith" in value
      ? String(row[key]).startsWith(String(value.startsWith))
      : row[key] === value,
  );
}

function pick(row: Row, select?: Record<string, boolean>) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
}

function botSecretDeps(seed: Row[] = []) {
  const now = new Date("2026-09-01T00:00:00.000Z");
  const bots: Row[] = [
    { id: "bot-1", userId: "user-1", spaceId: "space-1", archivedAt: null },
    { id: "bot-other", userId: "user-2", spaceId: "space-2", archivedAt: null },
  ];
  const rows: Row[] = seed.map((row) => ({ ...row }));
  const botSecret = {
    findMany: vi.fn(async (args: { where: Row; select?: Record<string, boolean> }) =>
      rows
        .filter((row) => matches(row, args.where))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((row) => pick(row, args.select)),
    ),
    findFirst: vi.fn(async (args: { where: Row; select?: Record<string, boolean> }) => {
      const row = rows.find((entry) => matches(entry, args.where));
      return row ? pick(row, args.select) : null;
    }),
    count: vi.fn(
      async (args: { where: Row }) => rows.filter((row) => matches(row, args.where)).length,
    ),
    create: vi.fn(async (args: { data: Row }) => {
      rows.push({ ...args.data, createdAt: now, updatedAt: now });
      return {};
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Row }) => {
      const row = rows.find((entry) => entry.id === args.where.id);
      Object.assign(row ?? {}, args.data, { updatedAt: now });
      return {};
    }),
    updateMany: vi.fn(async (args: { where: Row; data: Row }) => {
      // As Prisma does, an unknown column fails the update.
      const unknown = Object.keys(args.data).filter((key) => !["title", "note"].includes(key));
      if (unknown.length) throw new Error(`Unknown argument ${unknown.join(", ")}`);
      const matched = rows.filter((row) => matches(row, args.where));
      for (const row of matched) Object.assign(row, args.data, { updatedAt: now });
      return { count: matched.length };
    }),
    deleteMany: vi.fn(async (args: { where: Row }) => {
      const before = rows.length;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index] ?? {}, args.where)) rows.splice(index, 1);
      }
      return { count: before - rows.length };
    }),
  };
  const prisma = {
    bot: {
      findFirst: vi.fn(async (args: { where: Row }) => {
        const bot = bots.find((entry) => matches(entry, args.where));
        return bot ? { ...bot, thread: null, computer: null } : null;
      }),
    },
    vaultCredential: botSecret,
    // Counted before a prepared value that was never committed is deleted from the store.
    secret: { count: vi.fn(async () => 0) },
    integrationProviderConfig: { count: vi.fn(async () => 0) },
    // The member's vault lock always finds the user row.
    $queryRaw: vi.fn(async () => [{ locked: 1 }]),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  const secrets = {
    put: vi.fn(async (_plaintext: string, _context: unknown, options: { recordId: string }) => ({
      id: options.recordId,
      ref: `enc:${options.recordId}`,
      ciphertext: `enc:${options.recordId}`,
    })),
    // The fake store's ciphertext is "enc:<id>"; reading it back returns what put saved.
    load: vi.fn(async (ciphertext: string) => saved.get(ciphertext) ?? ""),
    delete: vi.fn(async () => undefined),
  };
  const saved = new Map<string, string>();
  secrets.put.mockImplementation(async (plaintext, _context, options) => {
    saved.set(`enc:${options.recordId}`, plaintext);
    return {
      id: options.recordId,
      ref: `enc:${options.recordId}`,
      ciphertext: `enc:${options.recordId}`,
    };
  });
  const auth = { hasRecentIdentityConfirmation: vi.fn(async () => false) };
  const deps = {
    auth,
    prisma: prisma as unknown as PrismaClient,
    secrets,
    env: {
      defaultProvider: "fake",
      defaultModel: "fake-model",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
    },
    dataDir: "/tmp/rakazo-router-test",
  } as unknown as RouterDeps;
  const handler = new RPCHandler(createRouter(deps));
  async function call(path: string, input: unknown) {
    const { response } = await handler.handle(
      new Request(`http://127.0.0.1/rpc/${path.includes("/") ? path : `vault/${path}`}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: input }),
      }),
      { prefix: "/rpc", context: { actor, sessionId: "session-1" } },
    );
    if (!response) throw new Error("Procedure did not match");
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as { json: unknown } };
  }
  return { prisma, secrets, rows, call, auth };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("vault router", () => {
  const destination = {
    name: "portal",
    origin: "https://portal.example.test",
    auth: { type: "bearer" },
  };

  it("names a new item from its title and never replaces one saved under that name", async () => {
    const { rows, prisma, call } = botSecretDeps();
    const home = (city: string) => ({
      destination: { auth: { type: "contact" } },
      value: JSON.stringify({ city }),
      title: "Home",
    });
    const first = await call("vault/put", home("Springfield"));
    expect(first.body.json).toMatchObject({ name: "home", title: "Home" });
    // Another save took "home" after this one looked: it is created under the next free name.
    prisma.vaultCredential.findMany.mockResolvedValueOnce([]);
    const second = await call("vault/put", home("Shelbyville"));
    expect(second.status).toBe(200);
    expect(second.body.json).toMatchObject({ name: "home-2", title: "Home" });
    expect(rows.map((row) => row.name)).toEqual(["home", "home-2"]);
    const listed = (await call("vault/list", {})).body.json as { preview?: unknown }[];
    expect(listed.map((item) => item.preview)).toEqual([
      { contact: { city: "Springfield" } },
      { contact: { city: "Shelbyville" } },
    ]);
  });

  it("changes only the title or note of a saved item when no value is sent", async () => {
    const { call } = botSecretDeps();
    await call("vault/put", { destination, value: FAKE_VALUE });
    const relabeled = await call("vault/put", { destination, title: "Portal", note: "For work" });
    expect(relabeled.body.json).toMatchObject({
      name: "portal",
      title: "Portal",
      note: "For work",
    });
    expect((await call("vault/reveal", { name: "portal" })).status).not.toBe(200);
    const missing = await call("vault/put", {
      destination: { ...destination, name: "missing" },
      title: "Missing",
    });
    expect(missing.status).toBe(404);
    const unnamed = await call("vault/put", {
      destination: { auth: { type: "contact" } },
      title: "Home",
    });
    expect(unnamed.status).toBe(400);
  });

  it("saves, lists and removes in the account vault by default", async () => {
    const { rows, call } = botSecretDeps();
    expect((await call("vault/put", { destination, value: FAKE_VALUE })).status).toBe(200);
    expect(rows).toEqual([expect.objectContaining({ userId: "user-1", name: "portal" })]);
    const listed = await call("vault/list", {});
    expect(listed.body.json).toEqual([expect.objectContaining({ name: "portal" })]);
    expect(listed.text).not.toContain(FAKE_VALUE);
    expect((await call("vault/remove", { name: "portal" })).status).toBe(200);
    expect(rows).toEqual([]);
  });

  it("reveals a value only after this session confirmed it's the owner", async () => {
    const { secrets, auth, call } = botSecretDeps();
    await call("vault/put", { destination, value: FAKE_VALUE });
    const refused = await call("vault/reveal", { name: "portal" });
    expect(refused.status).toBe(403);
    expect(refused.text).toContain("IDENTITY_CONFIRMATION_REQUIRED");
    expect(refused.text).not.toContain(FAKE_VALUE);
    expect(secrets.load).not.toHaveBeenCalled();

    auth.hasRecentIdentityConfirmation.mockResolvedValue(true);
    events.record.mockClear();
    const shown = await call("vault/reveal", { name: "portal" });
    expect(shown.body.json).toEqual({ value: FAKE_VALUE });
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "credential.revealed",
        metadata: expect.objectContaining({ name: "portal" }),
      }),
    );
    expect(JSON.stringify(events.record.mock.calls)).not.toContain(FAKE_VALUE);
    expect(auth.hasRecentIdentityConfirmation).toHaveBeenLastCalledWith({
      sessionId: "session-1",
      userId: "user-1",
    });
    expect((await call("vault/reveal", { name: "missing" })).status).toBe(404);
  });

  it("saves an older app's username and password as fields and reveals them", async () => {
    const { auth, call } = botSecretDeps();
    auth.hasRecentIdentityConfirmation.mockResolvedValue(true);
    await call("vault/put", {
      destination: { name: "site", origin: "https://login.example.test", auth: { type: "login" } },
      value: JSON.stringify({ username: "person@example.test", password: FAKE_VALUE }),
    });
    expect((await call("vault/reveal", { name: "site" })).body.json).toEqual({
      fields: [
        { label: "Username", value: "person@example.test", hidden: false },
        { label: "Password", value: FAKE_VALUE, hidden: true },
      ],
    });
  });

  it("reveals a website login's fields in order", async () => {
    const { auth, call } = botSecretDeps();
    auth.hasRecentIdentityConfirmation.mockResolvedValue(true);
    const fields = [
      { label: "Account number", value: "12345678", hidden: false },
      { label: "Date of birth", value: FAKE_VALUE, hidden: true },
    ];
    await call("vault/put", {
      destination: { name: "site", origin: "https://login.example.test", auth: { type: "login" } },
      value: encodeLoginSecret({ fields }),
    });
    expect((await call("vault/reveal", { name: "site" })).body.json).toEqual({ fields });
  });

  it("keeps a saved login on its site when saved again for another one", async () => {
    const login = {
      name: "portal",
      origin: "https://www.portal.example.test",
      auth: { type: "login" },
    };
    const saved = {
      id: "login-1",
      userId: "user-1",
      ...login,
      ciphertext: "enc:login-1",
    };
    const { rows, call } = botSecretDeps([saved]);
    const value = JSON.stringify({ username: "fake-user", password: FAKE_VALUE });
    for (const path of ["vault/put", "put"]) {
      const refused = await call(path, {
        ...(path === "put" ? { botId: "bot-1" } : {}),
        destination: { ...login, origin: "https://login.portal.example.test" },
        value,
      });
      expect(refused.status).toBe(400);
      expect(refused.text).toContain(
        "Remove the existing credential before changing its destination",
      );
      expect(refused.text).not.toContain(FAKE_VALUE);
    }
    expect(rows).toEqual([saved]);
  });
});
