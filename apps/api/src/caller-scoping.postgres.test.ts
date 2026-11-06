import { randomUUID } from "node:crypto";
import type { SecretStore } from "@labradoodle/adapter-kit";
import type { Actor, MessageBlock } from "@labradoodle/contracts";
import type { PrismaClient } from "@labradoodle/db";
import {
  asSystem,
  createDb,
  createOrganizationWithDefaultSpace,
  runAsTenant,
} from "@labradoodle/db";
import { RPCHandler } from "@orpc/server/fetch";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import { assertThreadImageInput } from "./thread-image-admission.js";

const describePostgres =
  process.env.VERIFY_DATABASE === "1" && process.env.DATABASE_URL
    ? describe.sequential
    : describe.skip;

const image: MessageBlock[] = [
  { kind: "image", artifactId: "image-1", name: "picture.png", mimeType: "image/png" },
];
const TEXT_ONLY = { modelProvider: "openrouter", modelId: "deepseek/deepseek-v4-pro" };
const CUSTOM_MODEL = "custom-vision-model";

describePostgres("caller and tenant scoping (PostgreSQL)", () => {
  // The runtime login enforces row-level security; the owner login bypasses it, as an
  // install that still connects the app as the table owner does.
  let runtime: ReturnType<typeof createDb>;
  let owner: ReturnType<typeof createDb>;
  let system: PrismaClient;
  const id = (label: string) => `${label}-${randomUUID()}`;
  const organizationId = id("org");
  const shared = id("space-shared");
  const other = id("space-other");
  const userA = id("user-a");
  const userB = id("user-b");
  const actorA: Actor = {
    userId: userA,
    spaceId: shared,
    email: `${userA}@rakazo.test`,
    isDeploymentOwner: false,
  };

  beforeAll(async () => {
    runtime = createDb(process.env.DATABASE_URL!);
    const ownerUrl = process.env.DATABASE_MIGRATION_URL;
    if (!ownerUrl || ownerUrl === process.env.DATABASE_URL)
      throw new Error("DATABASE_MIGRATION_URL must name the table owner login");
    owner = createDb(ownerUrl);
    system = asSystem(runtime.prisma);
    for (const user of [userA, userB])
      await system.user.create({
        data: { id: user, name: user, email: `${user}@rakazo.test`, emailVerified: true },
      });
    await system.organization.create({
      data: { id: organizationId, name: "Scoping", slug: organizationId, createdAt: new Date() },
    });
    for (const space of [shared, other])
      await system.space.create({ data: { id: space, organizationId, name: space } });
  });

  afterAll(async () => {
    await system.organization.deleteMany({
      where: { OR: [{ id: organizationId }, { members: { some: { userId: userA } } }] },
    });
    await system.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    for (const db of [runtime, owner]) {
      await db?.prisma.$disconnect();
      await db?.pool.end();
    }
  });

  const bot = (spaceId: string, userId: string, data: Record<string, unknown> = {}) =>
    system.bot.create({
      data: {
        spaceId,
        userId,
        name: "Scoped",
        color: "ink",
        thread: { create: { spaceId, userId } },
        ...data,
      },
    });
  const secret = (userId: string, spaceId: string | null) =>
    system.secret.create({
      data: { userId, spaceId, kind: spaceId ? "mcp" : "model", ciphertext: randomUUID() },
    });

  describe.each([
    ["the runtime login", () => runtime.prisma],
    ["the owner login, without row-level security", () => owner.prisma],
  ])("image admission through %s", (_role, prismaFor) => {
    const admit = (botId: string, configuration: Parameters<typeof assertThreadImageInput>[5]) =>
      runAsTenant(actorA, () =>
        assertThreadImageInput(prismaFor(), actorA, botId, image, undefined, configuration),
      );
    const hosted = () => ({
      secrets: { load: vi.fn(async () => "unused") },
      deployment: null,
      hostedProvider: TEXT_ONLY.modelProvider,
    });

    it("reads the space's bots, whoever created them, and none elsewhere", async () => {
      const own = await bot(shared, userA, TEXT_ONLY);
      const neighbors = await bot(shared, userB, TEXT_ONLY);
      const elsewhere = await bot(other, userA, TEXT_ONLY);

      await expect(admit(own.id, hosted())).rejects.toMatchObject({ code: "CONFLICT" });
      // Everyone in a space shares its bots, and a run uses the bot's own model.
      await expect(admit(neighbors.id, hosted())).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(admit(elsewhere.id, hosted())).resolves.toBeUndefined();
    });

    it.each([
      ["openai-compatible", CUSTOM_MODEL],
      ["openai-codex", "gpt-5.5"],
    ])("decrypts only the caller's account secret for %s", async (provider, modelId) => {
      const target = await bot(shared, userA, { modelProvider: provider, modelId });
      const credential = await system.userModelCredential.create({
        data: {
          userId: userA,
          provider,
          label: "Scoped",
          secretId: (await secret(userA, null)).id,
        },
      });
      const configured = () => {
        const load = vi.fn(async (_ciphertext: string, _ref?: string) =>
          JSON.stringify({
            kind: "openai_compatible",
            baseUrl: "http://127.0.0.1:9/v1",
            visionModelIds: [CUSTOM_MODEL],
          }),
        );
        return {
          load,
          configuration: {
            secrets: { load } as Pick<SecretStore, "load">,
            deployment: null,
            codexCatalog: { read: vi.fn(async () => undefined) },
          },
        };
      };
      const decryptedWith = async (secretId: string) => {
        await system.userModelCredential.update({
          where: { id: credential.id },
          data: { secretId },
        });
        const { load, configuration } = configured();
        const outcome = await admit(target.id, configuration).then(
          () => "admitted",
          () => "refused",
        );
        return { outcome, refs: load.mock.calls.map((call) => call[1]) };
      };

      const ownSecret = credential.secretId;
      const own = await decryptedWith(ownSecret);
      expect(own.refs).toContain(ownSecret);
      if (provider === "openai-compatible") expect(own.outcome).toBe("admitted");

      for (const foreign of [
        await secret(userB, null),
        await secret(userB, shared),
        await secret(userA, shared),
      ]) {
        const read = await decryptedWith(foreign.id);
        expect(read.refs).not.toContain(foreign.id);
        if (provider === "openai-compatible") expect(read.outcome).toBe("refused");
      }
    });
  });

  it("runs authenticated procedures inside the caller's tenant", async () => {
    const own = await bot(shared, userA, { name: "Own" });
    const elsewhere = await bot(other, userA, { name: "Elsewhere" });
    const router = createRouter({ prisma: runtime.prisma, env: {} } as unknown as RouterDeps);
    const call = async (procedure: string) => {
      const { response } = await new RPCHandler(router).handle(
        new Request(`https://api.example.test/rpc/${procedure}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: {} }),
        }),
        { prefix: "/rpc", context: { actor: actorA } },
      );
      expect(response?.status).toBe(200);
      return ((await response!.json()) as { json: Array<{ id: string; spaceId?: string }> }).json;
    };

    const listed = (await call("bots/list")).map((row) => row.id);
    expect(listed).toContain(own.id);
    expect(listed).not.toContain(elsewhere.id);
  });

  it("scopes a person with two organizations to the one their Space is in", async () => {
    const workId = randomUUID();
    const work = {
      defaultSpaceId: await createOrganizationWithDefaultSpace(system, {
        userId: userA,
        orgId: workId,
        name: "Work",
        slug: workId,
      }),
    };
    const inWork: Actor = { ...actorA, spaceId: work.defaultSpaceId };
    const workBot = await bot(work.defaultSpaceId, userA, { name: "Work" });
    const sharedBot = await bot(shared, userA, { name: "Shared" });
    const router = createRouter({ prisma: runtime.prisma, env: {} } as unknown as RouterDeps);
    const listed = async (actor: Actor) => {
      const { response } = await new RPCHandler(router).handle(
        new Request("https://api.example.test/rpc/bots/list", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: {} }),
        }),
        { prefix: "/rpc", context: { actor } },
      );
      return ((await response!.json()) as { json: Array<{ id: string }> }).json.map(
        (row) => row.id,
      );
    };

    expect(await listed(inWork)).toEqual([workBot.id]);
    expect(await listed(actorA)).toContain(sharedBot.id);
    expect(await listed(actorA)).not.toContain(workBot.id);
  });
});
