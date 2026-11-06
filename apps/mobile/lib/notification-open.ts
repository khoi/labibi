export type NotificationRoute = {
  pathname: "/thread";
  params: { threadId: string; spaceId?: string };
};

export type ThreadSpaceRequest =
  | { action: "show" }
  | { action: "switch"; spaceId: string }
  | { action: "unavailable" };

export function threadRouteId(name: string, params: Record<string, unknown>): string | undefined {
  const { threadId } = params;
  return typeof threadId === "string" && threadId ? JSON.stringify([name, threadId]) : undefined;
}

function singleRouteParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value) && value.length === 1) return singleRouteParam(value[0]);
  return undefined;
}

function notificationField(data: Record<string, unknown>, key: string): string | undefined {
  const direct = data[key];
  const prefixed = data[`labradoodle.${key}`];
  const value = typeof direct === "string" ? direct : prefixed;
  return typeof value === "string" ? singleRouteParam(value) : undefined;
}

/** A push or link for a chat opens that chat, in the workspace it belongs to. */
export function notificationOpenTarget(data: unknown): NotificationRoute | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  const threadId = notificationField(record, "threadId");
  if (!threadId) return null;
  const spaceId = notificationField(record, "spaceId");
  return { pathname: "/thread", params: { threadId, ...(spaceId ? { spaceId } : {}) } };
}

export function notificationResponseRoute(
  response: {
    actionIdentifier: string;
    notification: { request: { content: { data?: unknown } } };
  },
  defaultActionIdentifier: string,
): NotificationRoute | null {
  if (response.actionIdentifier !== defaultActionIdentifier) return null;
  return notificationOpenTarget(response.notification.request.content.data);
}

export function threadSpaceRequest(
  spaceId: string | string[] | undefined,
  selectedSpaceId: string | null,
): ThreadSpaceRequest {
  if (spaceId === undefined) return { action: "show" };
  const requested = singleRouteParam(spaceId);
  if (!requested) return { action: "unavailable" };
  if (requested === selectedSpaceId) return { action: "show" };
  return { action: "switch", spaceId: requested };
}

export function threadSpaceSwitchResult(
  requestedSpaceId: string,
  switched: boolean,
  selectedSpaceId: string | null,
): "ready" | "failed" {
  return switched && selectedSpaceId === requestedSpaceId ? "ready" : "failed";
}

export type ThreadRouteFocus = {
  focused: boolean;
  appliedFocus: boolean;
  activeSpaceId: string | null;
  liveSpaceId: string | null;
  switchFailed: boolean;
};

/** When a covered thread route is shown again, follow the space selected now. */
export function threadRouteSpaceOnFocus(input: ThreadRouteFocus): ThreadRouteFocus {
  if (input.focused === input.appliedFocus) return input;
  if (!input.focused) return { ...input, appliedFocus: false };
  return {
    focused: true,
    appliedFocus: true,
    activeSpaceId: input.liveSpaceId,
    liveSpaceId: input.liveSpaceId,
    switchFailed: false,
  };
}
