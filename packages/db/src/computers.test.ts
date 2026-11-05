import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import {
  ComputerLimitError,
  clearEndedExecutionRunBinding,
  computerHomeKey,
  computerScopeKey,
  ensureComputerRecord,
  resolveMaxComputersPerUser,
} from "./computers.js";

function fakePrisma(count = 0, existing = false) {
  return {
    // Looks like a TransactionClient: $queryRaw present, no $transaction.
    $queryRaw: vi.fn(async () => [{ lock: "1" }]),
    computer: {
      findUnique: vi.fn(async () => (existing ? { id: "existing" } : null)),
      count: vi.fn(async () => count),
      upsert: vi.fn(async (args) => args.update as object),
    },
  } as unknown as PrismaClient;
}

const baseInput = { spaceId: "space-1", userId: "user-1", kind: "docker" };

const savedEnv = process.env.SANDBOX_MAX_COMPUTERS_PER_USER;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.SANDBOX_MAX_COMPUTERS_PER_USER;
  else process.env.SANDBOX_MAX_COMPUTERS_PER_USER = savedEnv;
  vi.restoreAllMocks();
});

describe("clearEndedExecutionRunBinding", () => {
  function bindingPrisma(run: { status: string } | null) {
    return {
      computer: {
        findUnique: vi.fn(async () => ({ executionRunId: "run-1" })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      run: { findUnique: vi.fn(async () => run) },
    } as unknown as PrismaClient;
  }

  it("clears a binding whose run ended", async () => {
    const prisma = bindingPrisma({ status: "cancelled" });
    await clearEndedExecutionRunBinding(prisma, "computer-1");
    expect(prisma.computer.updateMany).toHaveBeenCalledWith({
      where: { id: "computer-1", executionRunId: "run-1" },
      data: { executionRunId: null, executionLeaseExpiresAt: null },
    });
  });

  it("clears a binding whose run no longer exists", async () => {
    const prisma = bindingPrisma(null);
    await clearEndedExecutionRunBinding(prisma, "computer-1");
    expect(prisma.computer.updateMany).toHaveBeenCalled();
  });

  it("leaves a binding whose run may still execute", async () => {
    const prisma = bindingPrisma({ status: "running" });
    await clearEndedExecutionRunBinding(prisma, "computer-1");
    expect(prisma.computer.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing when no binding is set", async () => {
    const prisma = {
      computer: {
        findUnique: vi.fn(async () => ({ executionRunId: null })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      run: { findUnique: vi.fn(async () => ({ status: "cancelled" })) },
    } as unknown as PrismaClient;
    await clearEndedExecutionRunBinding(prisma, "computer-1");
    expect(prisma.run.findUnique).not.toHaveBeenCalled();
    expect(prisma.computer.updateMany).not.toHaveBeenCalled();
  });
});

describe("computer keys", () => {
  const team = { spaceId: "space-1" };

  it("keys a team computer by space and user", () => {
    expect(computerScopeKey({ ...team, userId: "user-1" })).toBe("team:space-1:user-1");
    expect(computerScopeKey({ ...team, userId: "user-2" })).toBe("team:space-1:user-2");
  });

  it("gives each user a distinct home that survives the 40-character container name", () => {
    const first = computerHomeKey({ ...team, userId: "user-1" });
    const second = computerHomeKey({ ...team, userId: "user-2" });
    expect(first).toMatch(/^team-[0-9a-f]{32}$/);
    expect(first).toBe(computerHomeKey({ ...team, userId: "user-1" }));
    expect(first.slice(0, 40)).not.toBe(second.slice(0, 40));
    expect(computerHomeKey({ ...team, spaceId: "space-2", userId: "user-1" })).not.toBe(first);
  });
});

describe("resolveMaxComputersPerUser", () => {
  it("treats unset, empty, and 0 as no configured cap", () => {
    expect(resolveMaxComputersPerUser(undefined)).toBe(0);
    expect(resolveMaxComputersPerUser("")).toBe(0);
    expect(resolveMaxComputersPerUser("0")).toBe(0);
    expect(resolveMaxComputersPerUser("  ")).toBe(0);
  });

  it("accepts positive integers and rejects anything else", () => {
    expect(resolveMaxComputersPerUser("3")).toBe(3);
    for (const value of ["-1", "1.5", "not-a-number"])
      expect(() => resolveMaxComputersPerUser(value)).toThrow(/positive integer/);
  });
});

describe("ensureComputerRecord", () => {
  it("enforces the cap for a new computer when the user is at the limit", async () => {
    process.env.SANDBOX_MAX_COMPUTERS_PER_USER = "2";
    const prisma = fakePrisma(2, false);
    await expect(ensureComputerRecord(prisma, baseInput)).rejects.toThrow(ComputerLimitError);
    expect(prisma.computer.upsert).not.toHaveBeenCalled();
    // The quota lock, then the system bypass on and off around the cross-Space count.
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
  });

  it("reuses the person's computer even when they are at the cap", async () => {
    process.env.SANDBOX_MAX_COMPUTERS_PER_USER = "1";
    const prisma = fakePrisma(1, true);
    await expect(ensureComputerRecord(prisma, baseInput)).resolves.toBeDefined();
  });

  it("does not enforce anything when the cap is unset", async () => {
    const prisma = fakePrisma(99, false);
    await ensureComputerRecord(prisma, baseInput);
    expect(prisma.computer.upsert).toHaveBeenCalledOnce();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
