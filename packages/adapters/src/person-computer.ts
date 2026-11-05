import type { Computer, PrismaClient } from "@labradoodle/db";
import { ensureComputerRecord } from "@labradoodle/db";
import { sandboxKindForBot } from "./host-aware-sandbox.js";

type Owner = { spaceId: string; userId: string };

/** What a person's new computer starts as on this deployment. */
export async function newComputerKind(prisma: Pick<PrismaClient, "deploymentSettings">) {
  const settings = await prisma.deploymentSettings.findUnique({
    where: { id: "default" },
    select: { computerHost: true },
  });
  return sandboxKindForBot(process.env.SANDBOX_PROVIDER ?? "docker", settings?.computerHost);
}

/** A person's computer in a workspace, if they have one yet. */
export function findPersonComputer(
  prisma: Pick<PrismaClient, "computer">,
  owner: Owner,
): Promise<Computer | null> {
  return prisma.computer.findUnique({ where: { spaceId_userId: owner } });
}

/** A person's computer in a workspace, made the first time they need it. */
export async function ensurePersonComputer(prisma: PrismaClient, owner: Owner): Promise<Computer> {
  return (
    (await findPersonComputer(prisma, owner)) ??
    ensureComputerRecord(prisma, { ...owner, kind: await newComputerKind(prisma) })
  );
}
