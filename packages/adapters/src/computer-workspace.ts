import { constants } from "node:fs";
import { mkdir, open, statfs } from "node:fs/promises";
import path from "node:path";
import type {
  AdapterContext,
  AgentHomeStore,
  ComputerRef,
  PortableFile,
  SandboxProvider,
  StreamedPortableFile,
  WorkspaceDirectoryRequest,
  WorkspaceExportLimits,
} from "@labradoodle/adapter-kit";
import { WorkspaceTooLargeError } from "@labradoodle/adapter-kit";
import type { PrismaClient } from "@labradoodle/db";
import { getLogger } from "@labradoodle/logging";
import { normalizeWorkspacePath } from "./computer-support.js";
import { createStagingDirectory, LocalAgentHomeStore } from "./home.js";
import { isSandboxDamagedError } from "./sandbox-errors.js";
import { shouldSkipPortableWorkspaceFile, WORKSPACE_SAVE_LIMITS } from "./workspace-save-policy.js";

export { shouldSkipPortableWorkspaceFile, WORKSPACE_SAVE_LIMITS } from "./workspace-save-policy.js";

export const PORTABLE_TRANSFER_BATCH_BYTES = 8 * 1024 * 1024;

/** Disk a save leaves free for everything else on the data volume. */
const SAVE_DISK_RESERVE_BYTES = 2 * 1024 ** 3;
/** How often, in bytes written, a save checks the volume's free space again. */
const FREE_DISK_CHECK_BYTES = 256 * 1024 * 1024;
/** Disk a file costs beyond its contents, so many small files still trigger the check. */
const FILE_DISK_OVERHEAD_BYTES = 4096;

/** Docker computers mount the server's home directory, whichever store keeps it. */
export function mountsServerHome(kind: string) {
  return kind === "docker";
}

/** The computer already reads and writes the server's home directory, so there is nothing to copy. */
async function homeIsMounted(
  home: AgentHomeStore,
  sandbox: SandboxProvider,
  computer: ComputerRef,
  context: AdapterContext,
) {
  if (!(home instanceof LocalAgentHomeStore)) return false;
  if (mountsServerHome(computer.kind)) return true;
  // Object-backed homes must hydrate and export even when a claim was configured.
  if (home.describe().id !== "local-fs") return false;
  return (
    computer.kind === "kubernetes" && (await sandbox.hasMountedHome?.(computer, context)) === true
  );
}

export async function restoreComputerWorkspace(
  home: AgentHomeStore,
  sandbox: SandboxProvider,
  homeKey: string,
  computer: ComputerRef,
  context: AdapterContext,
): Promise<void> {
  if (await homeIsMounted(home, sandbox, computer, context)) return;
  await sandbox.importWorkspace(computer, home.exportHome(homeKey, context), context);
}

const REMOVE_CONTAINED_DIRECTORIES = [
  'parent="$1"',
  "shift",
  'case "$parent" in',
  "  .browser-profiles) pattern='^chromium-bot-[0-9a-f]{32}$' ;;",
  "  bots) pattern='^[A-Za-z0-9_-]+$' ;;",
  '  *) echo "folder escapes the team home" >&2; exit 1 ;;',
  "esac",
  'if [ -L "$parent" ]; then echo "folder escapes the team home" >&2; exit 1; fi',
  "remove_one() {",
  '  name="$1"',
  '  if [[ ! "$name" =~ $pattern ]]; then echo "folder escapes the team home" >&2; return 1; fi',
  '  target="$parent/$name"',
  '  if [ ! -e "$target" ] && [ ! -L "$target" ]; then return 0; fi',
  '  if [ -L "$target" ]; then rm -- "$target"; return; fi',
  '  if [ ! -d "$target" ]; then echo "folder escapes the team home" >&2; return 1; fi',
  '  resolved_parent=$(cd -- "$parent" && pwd -P)',
  '  resolved_target=$(cd -- "$target" && pwd -P)',
  '  case "$resolved_target" in',
  '    "$resolved_parent/$name") ;;',
  '    *) echo "folder escapes the team home" >&2; return 1 ;;',
  "  esac",
  // Go's module cache has read-only folders. Only folders need write access to empty them; file
  // modes stay, since a hard link can share a file with the rest of the home. find does not
  // follow links.
  '  find "$target" -type d ! -perm -0200 -exec chmod u+w {} + 2>/dev/null || true',
  '  rm -rf -- "$target"',
  "}",
  "status=0",
  'for name in "$@"; do remove_one "$name" || status=1; done',
  'exit "$status"',
].join("\n");

/**
 * Delete folders on the computer. Each name is checked on its own: a symlinked parent is
 * refused, a final symlink is unlinked, and one refused name does not stop the rest.
 */
export async function removeComputerWorkspaceDirectories(
  sandbox: SandboxProvider,
  computer: ComputerRef,
  parent: ".browser-profiles" | "bots",
  names: readonly string[],
  context: AdapterContext,
): Promise<void> {
  if (sandbox.workspaceDirectories) {
    await sandbox.workspaceDirectories(
      computer,
      { action: "remove", parent, names: [...names] },
      context,
    );
    return;
  }
  let exitCode: number | undefined;
  let stderr = "";
  for await (const event of sandbox.execute(
    computer,
    {
      argv: ["bash", "-eu", "-c", REMOVE_CONTAINED_DIRECTORIES, "bash", parent, ...names],
      cwd: ".",
    },
    context,
  )) {
    if (event.type === "stderr") stderr += event.data;
    if (event.type === "exit") exitCode = event.code;
  }
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || "workspace folder cleanup failed");
  }
}

/**
 * Run best-effort cleanup for at most budgetMs. Its commands are aborted at the deadline, and
 * a provider that ignores the abort still cannot hold the caller past it. Running out of time is
 * not a failure: every boot lists deleted bots' folders again and removes what is left.
 */
export async function withCleanupDeadline(
  context: AdapterContext,
  budgetMs: number,
  work: (context: AdapterContext) => Promise<void>,
): Promise<void> {
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error("computer cleanup ran out of time")),
    budgetMs,
  );
  const expired = new Promise<void>((resolve) => {
    deadline.signal.addEventListener(
      "abort",
      () => {
        getLogger().warn("computer cleanup ran out of time");
        resolve();
      },
      { once: true },
    );
  });
  const signal = AbortSignal.any([context.signal, deadline.signal]);
  try {
    await Promise.race([work({ ...context, signal }), expired]);
  } finally {
    clearTimeout(timer);
  }
}

// A shell glob also lists the symlinks some provider file listings leave out.
const LIST_TEAM_BOT_ENTRIES = [
  "for dir in bots .browser-profiles; do",
  '  if [ ! -d "$dir" ] || [ -L "$dir" ]; then continue; fi',
  '  for entry in "$dir"/*; do',
  '    if [ -e "$entry" ] || [ -L "$entry" ]; then printf \'%s\\n\' "$entry"; fi',
  "  done",
  "done",
].join("\n");

async function listTeamBotEntries(
  sandbox: SandboxProvider,
  computer: ComputerRef,
  context: AdapterContext,
): Promise<string[]> {
  let exitCode: number | undefined;
  let stdout = "";
  let stderr = "";
  if (sandbox.workspaceDirectories)
    return sandbox.workspaceDirectories(computer, { action: "list" }, context);
  for await (const event of sandbox.execute(
    computer,
    { argv: ["bash", "-eu", "-c", LIST_TEAM_BOT_ENTRIES], cwd: "." },
    context,
  )) {
    if (event.type === "stdout") stdout += event.data;
    if (event.type === "stderr") stderr += event.data;
    if (event.type === "exit") exitCode = event.code;
  }
  if (exitCode !== 0) throw new Error(stderr.trim() || "workspace folder listing failed");
  return stdout.split("\n").filter(Boolean);
}

export async function checkpointComputerWorkspace(
  home: AgentHomeStore,
  sandbox: SandboxProvider,
  homeKey: string,
  computer: ComputerRef,
  context: AdapterContext,
  /** The computer saved, read again after the export so a start meanwhile cancels the save. */
  record?: {
    prisma: Pick<PrismaClient, "computer">;
    computer: { id: string };
    /** Called once the export has finished, just before the files are stored. */
    onExported?: () => void;
  },
  saveLimits: WorkspaceExportLimits = WORKSPACE_SAVE_LIMITS,
): Promise<string | undefined> {
  // A machine whose restore never finished holds only part of the home: save nothing from it,
  // nor while a start that may still replace or restore it is under way. Every later start moves
  // the row into booting, which changes its screen generation, so one that began or even
  // finished during the export shows in the second read.
  const lifecycle = () =>
    record?.prisma.computer.findFirst({
      where: { id: record.computer.id },
      select: { state: true, restorePending: true, screenGeneration: true },
    });
  const before = await lifecycle();
  if (before?.restorePending || before?.state === "booting") return undefined;
  if (
    home instanceof LocalAgentHomeStore &&
    (await homeIsMounted(home, sandbox, computer, context))
  ) {
    return home.revise(homeKey);
  }
  // On the data volume, never a container's own disk, and removed later if this process dies.
  const staging =
    home instanceof LocalAgentHomeStore
      ? await home.createStaging()
      : await createStagingDirectory();
  try {
    const limits = await withinFreeDisk(saveLimits, staging.path);
    const copied = { bytes: 0, files: 0, unchecked: 0 };
    // Other saves share the volume, so free space is checked again as the disk use grows.
    const use = async (diskBytes: number) => {
      copied.unchecked += diskBytes;
      if (copied.unchecked < FREE_DISK_CHECK_BYTES) return;
      copied.unchecked = 0;
      if ((await freeDisk(staging.path)) < 0) throw new WorkspaceTooLargeError("bytes");
    };
    const count = async (bytes: number) => {
      copied.bytes += bytes;
      if (copied.bytes > limits.maxBytes) throw new WorkspaceTooLargeError("bytes");
      await use(bytes);
    };
    for await (const file of sandbox.exportWorkspace(computer, context, limits)) {
      if (shouldSkipPortableWorkspaceFile(file.path)) continue;
      if (++copied.files > limits.maxFiles) throw new WorkspaceTooLargeError("files");
      // Even an empty file takes an inode and usually a block.
      await use(FILE_DISK_OVERHEAD_BYTES);
      await writePortableFile(staging.path, file, count);
    }
    record?.onExported?.();
    if ((await lifecycle())?.screenGeneration !== before?.screenGeneration) return undefined;
    return await home.commit(homeKey, staging.path, context);
  } finally {
    await staging.remove();
  }
}

/** The save limits, lowered to the disk space left on the volume that stages the files. */
async function withinFreeDisk(
  limits: WorkspaceExportLimits,
  directory: string,
): Promise<WorkspaceExportLimits> {
  const free = await freeDisk(directory);
  return { ...limits, maxBytes: Math.max(0, Math.min(limits.maxBytes, free)) };
}

/** Bytes free on the volume beyond the reserve; unlimited where the platform cannot tell. */
async function freeDisk(directory: string) {
  const disk = await statfs(directory).catch(() => undefined);
  if (!disk) return Number.POSITIVE_INFINITY;
  return Number(disk.bavail) * Number(disk.bsize) - SAVE_DISK_RESERVE_BYTES;
}

export async function checkpointAndRecordComputerWorkspace(
  deps: { home: AgentHomeStore; sandbox: SandboxProvider; prisma: PrismaClient },
  computerRecord: { id: string; homeKey: string },
  computer: ComputerRef,
  context: AdapterContext,
): Promise<string | undefined> {
  const checkpointedAt = new Date();
  const revision = await checkpointComputerWorkspace(
    deps.home,
    deps.sandbox,
    computerRecord.homeKey,
    computer,
    context,
    { prisma: deps.prisma, computer: computerRecord },
  );
  if (revision === undefined) return undefined;
  await deps.prisma.computer.updateMany({
    where: { id: computerRecord.id },
    data: { homeRevision: revision, homeRevisionAt: checkpointedAt },
  });
  return revision;
}

/**
 * Saves the computer's workspace, then stops it. Nothing on a damaged computer can be read, so it
 * stops without the save and keeps the provider's last good copy; any other save failure throws
 * before anything is stopped. `onStop` runs just before the provider is asked to stop it.
 */
export async function checkpointAndStopComputer(
  deps: { home: AgentHomeStore; sandbox: SandboxProvider; prisma: PrismaClient },
  computerRecord: { id: string; homeKey: string },
  computer: ComputerRef,
  context: AdapterContext,
  onStop?: () => void,
): Promise<void> {
  try {
    await checkpointAndRecordComputerWorkspace(deps, computerRecord, computer, context);
  } catch (error) {
    if (!isSandboxDamagedError(error)) throw error;
    onStop?.();
    await deps.sandbox.stop(computer, context, { discardUnsaved: true });
    return;
  }
  onStop?.();
  await deps.sandbox.stop(computer, context);
}

/** Writes one exported file; a streamed one goes to disk chunk by chunk. */
async function writePortableFile(
  root: string,
  file: PortableFile | StreamedPortableFile,
  count: (bytes: number) => Promise<void>,
) {
  const relative = normalizeWorkspacePath(file.path);
  if (!relative) throw new Error("Workspace snapshots cannot contain an empty file path");
  const target = path.resolve(root, relative);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Workspace snapshot path escapes its staging directory");
  }
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(
    target,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0),
    file.executable ? 0o700 : 0o600,
  );
  try {
    for await (const chunk of "body" in file ? file.body : [file.content]) {
      await count(chunk.byteLength);
      for (let offset = 0; offset < chunk.byteLength; ) {
        const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
        offset += bytesWritten;
      }
    }
  } finally {
    await handle.close();
  }
}

/** Route directory intents through native providers while preserving the Unix fallback. */
export async function manageComputerWorkspaceDirectories(
  sandbox: SandboxProvider,
  computer: ComputerRef,
  request: WorkspaceDirectoryRequest,
  context: AdapterContext,
): Promise<string[]> {
  if (sandbox.workspaceDirectories) return sandbox.workspaceDirectories(computer, request, context);
  if (request.action === "list") return listTeamBotEntries(sandbox, computer, context);
  if (request.action === "remove") {
    await removeComputerWorkspaceDirectories(
      sandbox,
      computer,
      request.parent,
      request.names,
      context,
    );
    return [];
  }
  let code: number | undefined;
  let stderr = "";
  for await (const event of sandbox.execute(
    computer,
    { argv: ["mkdir", "-p", ...request.paths] },
    context,
  )) {
    if (event.type === "exit") code = event.code;
    if (event.type === "stderr") stderr += event.data;
  }
  if (code !== 0)
    throw new Error(`Could not prepare Team Computer folders${stderr ? `: ${stderr.trim()}` : ""}`);
  return [];
}
