import { createHash } from "node:crypto";
import path from "node:path";
import type { ComputerAction, ComputerObservation, ComputerRef } from "@labradoodle/adapter-kit";

export function toComputerRef(computer: {
  homeKey: string;
  kind: string;
  providerRef: string | null;
}): ComputerRef {
  if (!computer.providerRef) throw new Error("computer provider reference is missing");
  return {
    id: computer.providerRef,
    botId: computer.homeKey,
    kind: computer.kind as ComputerRef["kind"],
    providerRef: computer.providerRef,
  };
}

const EMPTY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

export function computerObservation(
  image: Uint8Array,
  input: Omit<ComputerObservation, "frameId" | "capturedAt" | "image">,
): ComputerObservation {
  return {
    ...input,
    image,
    frameId: createHash("sha256").update(image).digest("hex"),
    capturedAt: new Date().toISOString(),
  };
}

export function placeholderObservation(label = "ready"): ComputerObservation {
  return computerObservation(EMPTY_PNG, {
    mimeType: "image/png",
    width: 1,
    height: 1,
    activeWindow: { id: "placeholder", title: label },
  });
}

export function applyPlaceholderAction(box: { screen: string }, action: ComputerAction): void {
  if (action.kind === "clipboard") box.screen = action.text;
  else if (action.kind === "open") box.screen = `opened ${action.path}`;
  else if (action.kind === "launch") box.screen = `launched ${action.application}`;
  else if (action.kind === "focus") box.screen = `focused ${action.application}`;
  else box.screen = action.kind;
}

export function boundedComputerActions(actions: readonly ComputerAction[]): ComputerAction[] {
  if (actions.length > 24) throw new Error("computer action batch exceeds 24 actions");
  return [...actions];
}

export function clampRounded(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

export function normalizeWorkspacePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Path escapes the computer workspace");
  }
  return segments.join("/");
}

export function workspacePath(root: string, relative: string): string {
  const normalized = normalizeWorkspacePath(relative);
  return normalized ? path.posix.join(root, normalized) : root;
}

/** A path a person or Doodle gives, as stored on the computer: the home is the root. */
export function resolveWorkspacePath(rawPath: string): string {
  return expandHomePrefix(rawPath);
}

/** Paths a person may write to while controlling their computer: anywhere in its home. */
export function resolveUploadPath(requestedPath: string): string {
  return normalizeWorkspacePath(expandHomePrefix(requestedPath));
}

// A leading ~ or /home/labradoodle means the workspace root, the same as a leading /.
function expandHomePrefix(value: string): string {
  return value.replace(
    /^(?:~|[\\/]home[\\/]labradoodle)([\\/]|$)/,
    (_, separator: string) => separator || "/",
  );
}

export { shellQuote } from "@labradoodle/core/node/desktop-runtime";
