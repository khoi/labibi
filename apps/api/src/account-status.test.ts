import type * as Db from "@labradoodle/db";
import { describe, expect, it, vi } from "vitest";
import { revokeUserDevices } from "./user-devices.js";

vi.mock("@labradoodle/db", async (original) => ({
  ...(await original<typeof Db>()),
  cancelDeactivatedAccountRuns: vi.fn(
    async (_prisma: unknown, events: { notify(threadId: string, seq: number): Promise<void> }) => {
      await events.notify("thread-1", 4);
      return 1;
    },
  ),
}));

describe("ending a deactivated account's access", () => {
  it("disconnects the other computers when one fails", async () => {
    const disconnect = vi.fn(async () => undefined);
    const store = {
      prisma: {
        userDevice: {
          findMany: vi.fn(async () => [
            { id: "device-1", sessionId: null },
            { id: "device-2", sessionId: null },
          ]),
          updateMany: vi.fn(async ({ where }: { where: { id: string } }) => {
            if (where.id === "device-1") throw new Error("unavailable");
            return { count: 1 };
          }),
        },
      },
      devices: { disconnect },
    } as unknown as Parameters<typeof revokeUserDevices>[0];

    await expect(revokeUserDevices(store, "user-1")).rejects.toThrow(AggregateError);
    expect(disconnect).toHaveBeenCalledExactlyOnceWith("device-2", "session-ended");
  });
});
