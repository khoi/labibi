import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Auth } from "@labradoodle/auth";
import type { PrismaClient } from "@labradoodle/db";
import type { Hono } from "hono";

type SeedAccount = { email: string; name: string; image?: string };
type Seed = { password: string; accounts: SeedAccount[] };

const SEED_FILE = path.join(homedir(), ".labradoodle-dev-seed", "accounts.json");

export function readDevSeed(): Seed | null {
  if (!existsSync(SEED_FILE)) return null;
  return JSON.parse(readFileSync(SEED_FILE, "utf8")) as Seed;
}

export async function wipeDatabase(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    select tablename as name from pg_tables
    where schemaname = 'public' and tablename <> '_prisma_migrations'`;
  let pending = rows.map((row) => row.name);
  while (pending.length > 0) {
    const blocked: string[] = [];
    for (const table of pending) {
      await prisma.$executeRawUnsafe(`delete from "${table}"`).catch(() => blocked.push(table));
    }
    if (blocked.length === pending.length) {
      throw new Error(`Could not empty tables: ${blocked.join(", ")}`);
    }
    pending = blocked;
  }
}

export async function seedAccounts(
  app: Hono,
  deps: { prisma: PrismaClient; auth: Auth; webOrigin: string },
  seed: Seed,
) {
  const { prisma, auth, webOrigin } = deps;
  const hash = await (await auth.$context).password.hash(seed.password);
  const headers = { "content-type": "application/json", origin: webOrigin };
  for (const account of seed.accounts) {
    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: account.email,
        name: account.name,
        password: crypto.randomUUID(),
      }),
    });
    if (!signUp.ok) throw new Error(`Sign-up failed for ${account.email}: ${signUp.status}`);
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const bootstrap = await app.request("/rpc/bootstrap", {
      method: "POST",
      headers: { ...headers, cookie },
      body: JSON.stringify({ json: {} }),
    });
    if (!bootstrap.ok) throw new Error(`Setup failed for ${account.email}: ${bootstrap.status}`);
    const user = await prisma.user.update({
      where: { email: account.email },
      data: { emailVerified: true, image: account.image ? dataUrl(account.image) : null },
    });
    await prisma.account.updateMany({
      where: { userId: user.id, providerId: "credential" },
      data: { password: hash },
    });
    await prisma.space.updateMany({
      where: { name: "Workspace", memberships: { some: { userId: user.id, role: "owner" } } },
      data: { name: `${account.name}'s workspace` },
    });
    await prisma.session.deleteMany({ where: { userId: user.id } });
  }
}

function dataUrl(file: string) {
  const type = path.extname(file).slice(1).replace("jpg", "jpeg");
  return `data:image/${type};base64,${readFileSync(file).toString("base64")}`;
}
