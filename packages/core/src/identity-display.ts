import type { MessageBlock } from "@labradoodle/contracts";
import { displayMessageBlock, displayName } from "./display-name.js";
import { identitySourceField, preserveIdentitySource } from "./identity-source.js";

export type IdentityLabels = {
  workspace: string;
  routine: string;
  member: string;
  subagent: string;
};

type Project = (value: unknown) => unknown;

// Project only known identity fields in known RPC responses. Never walk arbitrary
// message bodies, tool results, files or provider configuration looking for names.
function fields(value: unknown, projections: Record<string, Project>): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  let result = source;
  for (const [key, project] of Object.entries(projections)) {
    if (!Object.hasOwn(source, key)) continue;
    const next = project(identitySourceField(source, key));
    if (Object.is(next, source[key])) continue;
    if (result === source) result = { ...source };
    result[key] = next;
  }
  return preserveIdentitySource(source, result);
}
const list =
  (project: Project): Project =>
  (value) => {
    if (!Array.isArray(value)) return value;
    const next = value.map(project);
    return next.every((item, index) => Object.is(item, value[index])) ? value : next;
  };
const label =
  (fallback: string): Project =>
  (value) =>
    displayName(typeof value === "string" ? value : undefined, fallback);

export function displayIdentityEvent<T extends { type: string; payload?: Record<string, unknown> }>(
  event: T,
  labels: IdentityLabels,
): T {
  return {
    ...event,
    payload: fields(event.payload, {
      blocks: list((block) => displayMessageBlock(block as MessageBlock, labels)),
      ...(event.type === "thread.subagent" ? { name: label(labels.subagent) } : {}),
    }) as T["payload"],
  };
}

/** Translate fallbacks at the client boundary while leaving wire/storage names intact. */
export function displayIdentityResult(
  path: readonly string[],
  result: unknown,
  labels: IdentityLabels,
): unknown {
  const workspace: Project = (value) => fields(value, { name: label(labels.workspace) });
  const member: Project = (value) => fields(value, { name: label(labels.member) });
  const chat: Project = (value) => fields(value, { members: list(member) });
  const routine: Project = (value) => fields(value, { name: label(labels.routine) });
  const messages = list((message) =>
    fields(message, {
      blocks: list((block) => displayMessageBlock(block as MessageBlock, labels)),
    }),
  );
  const thread: Project = (value) => fields(value, { chat, messages });
  const procedure = path.join("/");
  if (procedure === "bootstrap")
    return fields(result, { workspaces: list(workspace), chats: list(chat), thread });
  if (procedure === "spaces/list") return list(workspace)(result);
  if (procedure === "spaces/rename") return workspace(result);
  if (procedure === "threads/list") return list(chat)(result);
  if (procedure === "threads/members") return list(member)(result);
  if (procedure === "threads/get" || procedure === "threads/messages") return thread(result);
  if (procedure === "routines/list") return list(routine)(result);
  if (/^routines\/(create|update)$/.test(procedure)) return routine(result);
  if (procedure === "search/query")
    return fields(result, {
      hits: list((value) =>
        (value as { kind?: string }).kind === "routine"
          ? fields(value, { title: label(labels.routine) })
          : value,
      ),
    });
  return result;
}
