import { describe, expect, it, vi } from "vitest";
import {
  findAutoReviewPreference,
  listApprovalRules,
  removeApprovalRule,
  saveApprovalRule,
  saveAutoReviewPreference,
} from "./approval-settings.js";
import type { PrismaClient } from "./client.js";

const scope = { userId: "user", spaceId: "space" };
const rule = { effect: "always_allow", matchKind: "tool", matchValue: "send" };

function confirmationsClient() {
  const table = () => ({
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({ id: "row" }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  });
  const tables = {
    userActionApprovalRule: table(),
    userActionAutoReviewPreference: table(),
  };
  const prisma = {
    ...tables,
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
  } as unknown as PrismaClient;
  return { prisma, ...tables };
}

describe("approval rules", () => {
  it("are the account's", async () => {
    const client = confirmationsClient();

    await listApprovalRules(client.prisma, scope);
    await saveApprovalRule(client.prisma, scope, rule);
    await removeApprovalRule(client.prisma, scope, "rule-1");

    expect(client.userActionApprovalRule.findMany).toHaveBeenCalledWith({
      where: { userId: "user" },
      orderBy: { createdAt: "asc" },
    });
    expect(client.userActionApprovalRule.upsert).toHaveBeenCalledWith({
      where: { userId_effect_matchKind_matchValue: { userId: "user", ...rule } },
      create: { userId: "user", ...rule },
      update: {},
    });
    expect(client.userActionApprovalRule.deleteMany).toHaveBeenCalledWith({
      where: { id: "rule-1", userId: "user" },
    });
  });

  it("replace every other rule for the same match, including case variants", async () => {
    const client = confirmationsClient();
    client.userActionApprovalRule.findMany.mockResolvedValueOnce([
      { id: "same", effect: "always_allow", matchValue: "send" },
      { id: "upper", effect: "always_allow", matchValue: "SEND" },
      { id: "ask", effect: "require_approval", matchValue: "Send" },
      { id: "other", effect: "always_allow", matchValue: "send_email" },
    ]);

    await saveApprovalRule(client.prisma, scope, rule);

    expect(client.userActionApprovalRule.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["upper", "ask"] } },
    });
  });
});

describe("auto review", () => {
  it("reads and writes the account's choice", async () => {
    const client = confirmationsClient();
    client.userActionAutoReviewPreference.findUnique.mockResolvedValue({
      enabled: true,
      skipApprovals: false,
    });

    await expect(findAutoReviewPreference(client.prisma, scope)).resolves.toEqual({
      enabled: true,
      skipApprovals: false,
    });
    await saveAutoReviewPreference(
      client.prisma,
      scope,
      { skipApprovals: true },
      { enabled: false, skipApprovals: false },
    );

    expect(client.userActionAutoReviewPreference.upsert).toHaveBeenCalledWith({
      where: { userId: "user" },
      create: { userId: "user", enabled: false, skipApprovals: true },
      update: { skipApprovals: true },
    });
  });
});
