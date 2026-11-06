/** The chat panel opens on one of its tabs; a routine opens in its own editor. */
export type Panel = "files" | "memory" | "routines" | "routine" | null;
export type RightPanelState = { panel: Panel; routineId?: string };

/** Panels that are safe to remember across reloads. */
const durablePanels: readonly Panel[] = ["files", "memory", "routines", "routine", null];

export function rightPanelStorageKey(userId: string, spaceId: string, threadId: string): string {
  return `labradoodle:right-panel-state:${userId}:${spaceId}:chat:${threadId}`;
}

export function readRightPanelState(key: string): RightPanelState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      !("panel" in value) ||
      !durablePanels.includes(value.panel as Panel)
    )
      return { panel: null };
    return {
      panel: value.panel as Panel,
      ...(value.panel === "routine" &&
      "routineId" in value &&
      typeof value.routineId === "string" &&
      value.routineId
        ? { routineId: value.routineId }
        : {}),
    };
  } catch {
    return { panel: null };
  }
}

export function writeRightPanelState(key: string, panel: Panel, routineId?: string) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ panel, ...(panel === "routine" && routineId ? { routineId } : {}) }),
    );
  } catch {
    // Restricted storage must not prevent opening or closing the panel.
  }
}
