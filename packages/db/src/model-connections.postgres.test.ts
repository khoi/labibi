import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { getModelRole, updateModelRole } from "./model-roles.js";
import { asSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

describePostgres("model connections (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `model-connections-user-${suffix}`;
  const organizationId = `model-connections-organization-${suffix}`;
  const spaceId = `model-connections-space-${suffix}`;
  const personal = `model-connections-personal-${suffix}`;
  const work = `model-connections-work-${suffix}`;
  const azure = `model-connections-azure-${suffix}`;
  const scope = { userId };
  let prisma: PrismaClient;
  let close: () => Promise<void>;

  const connect = async (id: string, provider: string) => {
    await prisma.secret.create({
      data: { id, userId, kind: "model", ciphertext: "fake-ciphertext" },
    });
    await prisma.userModelCredential.create({
      data: { id, userId, provider, label: provider, secretId: id },
    });
  };
  const rows = () =>
    prisma.userModelRoleChoice.findMany({
      where: { userId },
      orderBy: [{ role: "asc" }, { position: "asc" }],
      select: { role: true, position: true, provider: true, modelId: true, credentialId: true },
    });

  beforeAll(async () => {
    const db = createDb(databaseUrl!);
    prisma = asSystem(db.prisma);
    close = async () => {
      await db.prisma.$disconnect();
      await db.pool.end();
    };
    const createdAt = new Date();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Connections",
        email: `${userId}@rakazo.test`,
        emailVerified: false,
      },
    });
    await prisma.organization.create({
      data: { id: organizationId, name: "Connections", slug: organizationId, createdAt },
    });
    await prisma.member.create({
      data: { id: `${userId}-member`, organizationId, userId, role: "owner", createdAt },
    });
    await prisma.space.create({
      data: { id: spaceId, organizationId, name: spaceId, createdByUserId: userId },
    });
    await prisma.spaceMember.create({
      data: { id: `${spaceId}-member`, spaceId, organizationId, userId, createdAt },
    });
  });

  beforeEach(async () => {
    await prisma.userModelRoleChoice.deleteMany({ where: { userId } });
    await prisma.userModelCredential.deleteMany({ where: { userId } });
    await prisma.secret.deleteMany({ where: { userId } });
    await connect(personal, "openai-codex");
    await connect(azure, "azure-openai-responses");
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await close();
  });

  it("lists the same model on two connections, and falls back between them", async () => {
    await connect(work, "openai-codex");
    await updateModelRole(prisma, scope, "main", {
      primary: { provider: "openai-codex", modelId: "gpt-5", credentialId: personal },
      backups: [{ provider: "openai-codex", modelId: "gpt-5", credentialId: work }],
    });
    await expect(getModelRole(prisma, scope, "main")).resolves.toEqual({
      primary: { provider: "openai-codex", modelId: "gpt-5", credentialId: personal },
      backups: [{ provider: "openai-codex", modelId: "gpt-5", credentialId: work }],
    });
  });

  it("keeps a model once per connection, including rows that name none", async () => {
    const row = { userId, role: "main", provider: "xai", modelId: "grok" };
    await prisma.userModelRoleChoice.create({ data: { ...row, position: 0 } });
    await expect(
      prisma.userModelRoleChoice.create({ data: { ...row, position: 1 } }),
    ).rejects.toThrow();
  });

  it("removes a connection's rows with it and keeps the other account's", async () => {
    await connect(work, "openai-codex");
    await updateModelRole(prisma, scope, "main", {
      primary: { provider: "openai-codex", modelId: "gpt-5", credentialId: personal },
      backups: [{ provider: "openai-codex", modelId: "gpt-5", credentialId: work }],
    });
    await prisma.userModelCredential.delete({ where: { id: personal } });
    expect(await rows()).toEqual([
      { role: "main", position: 1, provider: "openai-codex", modelId: "gpt-5", credentialId: work },
    ]);
  });

  it("keeps a row's connection when an older app saves it without one", async () => {
    await updateModelRole(prisma, scope, "main", {
      primary: { provider: "openai-codex", modelId: "gpt-5", credentialId: personal },
      backups: [{ provider: "azure", modelId: "gpt-4o", credentialId: azure }],
    });
    // The previous order, reversed by an app that predates connections.
    await updateModelRole(prisma, scope, "main", {
      primary: { provider: "azure", modelId: "gpt-4o" },
      backups: [{ provider: "openai-codex", modelId: "gpt-5" }],
    });
    expect((await rows()).map((row) => row.credentialId)).toEqual([azure, personal]);
  });
});
