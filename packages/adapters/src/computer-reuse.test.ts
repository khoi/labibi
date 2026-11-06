import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { AdapterContext, JobPublisher } from "@labradoodle/adapter-kit";
import type * as Db from "@labradoodle/db";
import type { PrismaClient, ThreadEvents } from "@labradoodle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provisionComputer } from "./computer-lifecycle.js";
import { DockerSandboxProvider } from "./docker-sandbox.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { LocalAgentHomeStore } from "./home.js";
import { HostAwareSandbox } from "./host-aware-sandbox.js";

// The plan's size is read from billing, which these Prisma doubles do not model.
vi.mock("@labradoodle/db", async (importOriginal) => ({
  ...(await importOriginal<typeof Db>()),
}));

const context = {
  operationId: "test",
  traceId: "test",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
} satisfies AdapterContext;

async function fixture() {
  const directory = await mkdtemp(path.join(process.cwd(), ".computer-reuse-"));
  const row = {
    id: "computer",
    homeKey: "bot",
    providerRef: "provider",
    kind: "docker",
    scope: "team",
    state: "running",
    screenGeneration: 7,
    maintenanceId: null as string | null,
    controlLeaseId: null,
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
  let assigned = true;
  const updateMany = vi.fn(async ({ where, data }) => {
    if (
      !assigned ||
      Object.entries(where).some(
        ([key, value]) => key in row && row[key as keyof typeof row] !== value,
      )
    )
      return { count: 0 };
    // Model the database trigger that revokes viewers on a lifecycle transition.
    if (
      data.state &&
      data.state !== row.state &&
      !(row.state === "booting" && data.state === "running")
    ) {
      row.screenGeneration++;
    }
    Object.assign(row, data);
    return { count: 1 };
  });
  const docker = new DockerSandboxProvider("http://supervisor.test", "test-token");
  const ref = {
    id: "provider",
    providerRef: "provider",
    botId: "bot",
    kind: "docker" as const,
    fresh: false,
  };
  const provision = vi.spyOn(docker, "provision").mockResolvedValue(ref);
  const prepare = vi.spyOn(docker, "prepare");
  const execute = vi.spyOn(docker, "execute").mockImplementation(async function* () {
    yield { type: "exit", code: 0 };
  });
  const sandbox = new HostAwareSandbox(docker, new FakeSandboxProvider(), async () => false);
  const deps = {
    prisma: {
      computer: { findUniqueOrThrow: vi.fn(async () => ({ ...row })), updateMany },
    } as unknown as PrismaClient,
    sandbox,
    home: new LocalAgentHomeStore(directory),
    jobs: {} as JobPublisher,
    events: {} as ThreadEvents,
    dataDir: directory,
  };
  return {
    row,
    deps,
    provision,
    prepare,
    execute,
    updateMany,
    unassign: () => {
      assigned = false;
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("running Docker computer reuse", () => {
  it.each<[Date | null, string]>([
    [null, "starts"],
    [new Date("2024-01-01T00:00:00Z"), "keeps"],
  ])("a confirmed running computer with clock %s %s its active-lifetime clock", async (since) => {
    const f = await fixture();
    Object.assign(f.row, { runningSince: since });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ running: true })),
    );
    try {
      await provisionComputer(f.deps, "computer", context, "bot");
      const runningSince = (f.row as unknown as { runningSince: Date | null }).runningSince;
      if (since) expect(runningSince).toEqual(since);
      else expect(runningSince).toBeInstanceOf(Date);
    } finally {
      await f.cleanup();
    }
  });
});
