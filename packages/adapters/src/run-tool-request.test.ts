import { describe, expect, it } from "vitest";
import type { ToolRequest } from "./run-tool-request.js";
import { prepareToolRequest } from "./run-tool-request.js";

describe("private task tools after shared-channel messages", () => {
  it.each(["user", "bot_message", "webhook"])("keeps %s task tools available", async (trigger) => {
    const ctx = {
      deps: { prisma: { steeringMessage: { findFirst: async () => null } } },
      run: { trigger },
      bot: {},
      runId: "run-1",
      source: {},
    };
    for (const name of ["schedule_update", "skill_read"]) {
      await expect(
        prepareToolRequest(ctx as never, { name, args: {}, executionId: "call-1" } as ToolRequest),
      ).resolves.toBeUndefined();
    }
  });
});
