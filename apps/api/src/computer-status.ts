import {
  computerSupportsTerminal,
  computerSupportsUpdate,
  DISK_WARNING_PERCENT,
  diskUsedPercent,
} from "@labradoodle/adapters";
import type { ComputerStatus } from "@labradoodle/contracts";
import { ACTIVE_RUN_STATUSES, computerScreenSize } from "@labradoodle/core";

/** Mirrors computer.takeover: an execution lease blocks user control unless a takeover is pending. */
export function executionBlocksUserTakeover(input: {
  hasLease: boolean;
  leaseExpiresAt: Date | null | undefined;
  runStatus: string | null | undefined;
  now?: number;
  takeoverRequested?: boolean;
}): boolean {
  if (!input.hasLease) return false;
  if (input.runStatus === "waiting_takeover" || input.takeoverRequested) return false;
  const now = input.now ?? Date.now();
  const leaseActive = Boolean(input.leaseExpiresAt && input.leaseExpiresAt.getTime() > now);
  const runActive = Boolean(
    input.runStatus && (ACTIVE_RUN_STATUSES as readonly string[]).includes(input.runStatus),
  );
  return leaseActive || runActive;
}

/** The person's own computer as they see it, or what one would start as before they have one. */
export function toComputerStatus(
  computer: {
    kind: string;
    state: string;
    controlHolder: string;
    controlRunId?: string | null;
    homeRevision: string;
    maintenanceId?: string | null;
    diskUsedBytes?: bigint | null;
    diskFreeBytes?: bigint | null;
    diskDismissedPercent?: number | null;
  } | null,
  plannedKind = "fake",
): ComputerStatus {
  const kind = (computer?.kind ?? plannedKind) as ComputerStatus["kind"];
  const state =
    kind === "none"
      ? "stopped"
      : computer?.maintenanceId
        ? "booting"
        : computer?.state === "quarantined"
          ? "error"
          : computer?.state === "suspending"
            ? "running"
            : computer?.state === "stopped" ||
                computer?.state === "booting" ||
                computer?.state === "running" ||
                computer?.state === "suspended" ||
                computer?.state === "error"
              ? computer.state
              : "stopped";
  const screen = computerScreenSize(kind);
  const diskPercent = computer ? diskUsedPercent(computer) : null;
  const diskFull =
    diskPercent !== null &&
    diskPercent >= DISK_WARNING_PERCENT &&
    diskPercent > (computer?.diskDismissedPercent ?? 0);
  return {
    kind,
    state,
    controlHolder: (computer?.controlHolder ?? "none") as ComputerStatus["controlHolder"],
    takeoverRequested: Boolean(computer?.controlRunId),
    screenAvailable: !computer?.maintenanceId && (state === "running" || state === "booting"),
    screenWidth: screen.width,
    screenHeight: screen.height,
    homeRevision: computer?.homeRevision ?? null,
    canUpdate: computerSupportsUpdate(kind),
    terminalAvailable: computerSupportsTerminal(kind),
    ...(diskFull ? { diskFullPercent: diskPercent } : {}),
  };
}
