import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { asSystem, bootstrapUserSpace, createDb } from "@labradoodle/db";
import { expect, it } from "vitest";
import { opaque } from "../diagnostics.js";

const run = promisify(execFile);
const testDatabase = process.env.VERIFY_DATABASE === "1" ? process.env.DATABASE_URL : undefined;

it.skipIf(!testDatabase)(
  "reports an MCP server assigned to a bot as the runtime login, without its details",
  async () => {
    if (!testDatabase) throw new Error("DATABASE_URL is required");
    const { prisma: client, pool } = createDb(testDatabase);
    const prisma = asSystem(client);
    const user = await prisma.user.create({
      data: { id: randomUUID(), name: "Private Person", email: `${randomUUID()}@example.test` },
    });
    try {
      const { spaceId } = await bootstrapUserSpace(prisma, user, {
        signupsEnabled: "true",
        signupAllowlist: "",
      });
      const bot = await prisma.bot.upsert({
        where: { spaceId },
        create: { spaceId },
        update: {},
      });
      const server = await prisma.mcpServer.create({
        data: {
          spaceId,
          userId: user.id,
          slug: "private-tools",
          name: "Private Tools",
          transport: "stdio",
          command: "/opt/private/bin/tool",
          env: { TOKEN: "sk-private-token" },
          healthStatus: "ok",
          healthToolCount: 7,
        },
      });

      const { stdout } = await run(
        "pnpm",
        ["--filter", "@labradoodle/api", "exec", "tsx", "src/cli/diagnostics.ts"],
        {
          env: {
            ...process.env,
            DATABASE_MIGRATION_URL: undefined,
            MCP_STDIO_ENABLED: "true",
            MCP_STDIO_ALLOWED_COMMANDS: "/opt/private/bin/tool",
          },
        },
      );
      expect(stdout).toContain("- Connection: ok");
      expect(stdout).toContain("- MCP_STDIO_ALLOWED_COMMANDS: 1");
      expect(stdout).toContain(`| ${opaque(server.id)} | stdio | on | ok | 7 |`);
      for (const value of [
        "Private",
        "private",
        "Secret Bot",
        "sk-private-token",
        "/opt/",
        user.id,
        bot.id,
        server.id,
        spaceId,
      ])
        expect(stdout).not.toContain(value);
    } finally {
      await client.$disconnect();
      await pool.end();
    }
  },
  60_000,
);
