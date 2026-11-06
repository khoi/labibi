import type { AppBootstrap } from "@labradoodle/contracts";

export function initialBootstrapTarget(path: string, desktop: boolean) {
  const pathname = path.split(/[?#]/)[0] ?? "";
  const appRoute = pathname === "/app" || pathname.startsWith("/app/");
  if (!appRoute && !(desktop && pathname === "/")) return null;
  return { threadId: appRoute ? threadIdFromPath(pathname) : undefined };
}

function threadIdFromPath(pathname: string) {
  const segments = pathname.split("/");
  if (segments[2] !== "c") return undefined;
  const encoded = segments[3];
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

/**
 * Where to open a linked chat that is the user's but not in the workspace just loaded. The link's
 * query (a message to jump to, a routine) comes along.
 */
export function linkedChatRoute(
  bootstrap: Pick<AppBootstrap, "threadSpaceId" | "chats" | "me">,
  threadId: string | undefined,
  search: string,
): { spaceId: string; path: string } | undefined {
  if (!threadId || !bootstrap.threadSpaceId || bootstrap.threadSpaceId === bootstrap.me.spaceId)
    return undefined;
  if (bootstrap.chats.some((chat) => chat.id === threadId)) return undefined;
  return { spaceId: bootstrap.threadSpaceId, path: `${chatPath(threadId)}${search}` };
}

export function chatPath(threadId: string) {
  return `/app/c/${encodeURIComponent(threadId)}`;
}
