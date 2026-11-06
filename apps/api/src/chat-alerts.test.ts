import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";

describe("notifications.subscribe", () => {
  it("requires a signed-in user", async () => {
    const client = createRouterClient(createRouter({} as unknown as RouterDeps), {
      context: { actor: null },
    });
    await expect(client.notifications.subscribe()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
