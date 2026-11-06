import { createHash, timingSafeEqual } from "node:crypto";
import { hasActiveComputerControl } from "@labradoodle/adapters";
import {
  openScreenCapability,
  SCREEN_TARGET_ENDPOINT,
} from "@labradoodle/core/node/screen-capability";
import type { PrismaClient } from "@labradoodle/db";
import { runAsSystem } from "@labradoodle/db";
import type { Hono } from "hono";
import { requestBodyLimit } from "./request-body-limit.js";

export function mountScreenTarget(app: Hono, prisma: PrismaClient, secret: string) {
  app.post(SCREEN_TARGET_ENDPOINT, requestBodyLimit(16 * 1024), async (c) => {
    c.header("cache-control", "no-store");
    const supplied = Buffer.from(c.req.header("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (
      !secret ||
      supplied.length === 0 ||
      !timingSafeEqual(
        createHash("sha256").update(supplied).digest(),
        createHash("sha256").update(expected).digest(),
      )
    )
      return c.body(null, 403);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.path !== "string") return c.body(null, 403);
    const capability = openScreenCapability(body.path, secret);
    if (!capability) return c.body(null, 403);
    const { scope, target } = capability;
    // The sealed capability, not a session, names the computer and the Doodle whose screen it is.
    const computer = await runAsSystem("check a screen proxy capability", async () => {
      const found = await prisma.computer.findUnique({
        where: { id: scope.computerId },
        select: {
          spaceId: true,
          screenGeneration: true,
          providerRef: true,
          state: true,
          controlHolder: true,
          controlLeaseId: true,
          controlLeaseExpiresAt: true,
        },
      });
      const doodle =
        found &&
        (await prisma.bot.findFirst({
          where: { id: scope.botId, spaceId: found.spaceId },
          select: { id: true },
        }));
      return doodle ? found : null;
    });
    if (
      !computer ||
      computer.screenGeneration !== scope.computerGeneration ||
      !computer.providerRef ||
      !["running", "booting"].includes(computer.state) ||
      (target.interactive &&
        (!hasActiveComputerControl(computer) ||
          !scope.controlLeaseId ||
          computer.controlLeaseId !== scope.controlLeaseId))
    )
      return c.body(null, 403);
    return c.json(target);
  });
}
