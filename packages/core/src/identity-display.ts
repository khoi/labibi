import type { MessageBlock } from "@labradoodle/contracts";
import { displayMessageBlock, displayName } from "./display-name.js";
import { identitySourceField, preserveIdentitySource } from "./identity-source.js";

export type IdentityLabels = {
  bot: string;
  group: string;
  space: string;
  routine: string;
  member: string;
  subagent: string;
  owner: string;
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
  const member: Project = (value) => fields(value, { name: label(labels.bot) });
  const bot: Project = (value) => fields(value, { name: label(labels.bot), title: label("") });
  const group: Project = (value) =>
    fields(value, { name: label(labels.group), members: list(member) });
  const routine: Project = (value) => fields(value, { name: label(labels.routine) });
  const thread: Project = (value) =>
    fields(value, {
      groupName: (name) => (name === null ? null : label(labels.group)(name)),
      members: list(member),
      messages: list((message) =>
        fields(message, {
          blocks: list((block) => displayMessageBlock(block as MessageBlock, labels)),
        }),
      ),
    });
  const space: Project = (value) =>
    fields(value, {
      name: label(labels.space),
      bots: list(bot),
      groups: list(group),
    });
  const procedure = path.join("/");
  if (procedure === "bootstrap")
    return fields(result, {
      bots: list(bot),
      groups: list(group),
      spaces: list(space),
      routines: list(routine),
      thread,
    });
  if (procedure === "spaces/list") return fields(result, { current: space, spaces: list(space) });
  if (procedure === "spaces/rename") return space(result);
  if (procedure === "bots/list") return list(bot)(result);
  if (/^bots\/(get|create|update|restoreInstructions|setComputer)$/.test(procedure))
    return bot(result);
  if (procedure === "groups/list") return list(group)(result);
  if (/^groups\/(get|create|update)$/.test(procedure)) return group(result);
  if (procedure === "routines/list") return list(routine)(result);
  if (procedure === "routines/listForMentions")
    return list((value) => fields(value, { routines: list(routine) }))(result);
  if (/^routines\/(create|update)$/.test(procedure)) return routine(result);
  if (procedure === "threads/get" || procedure === "threads/messages") return thread(result);
  if (procedure === "runs/list")
    return fields(result, {
      runs: list((run) =>
        fields(run, {
          botName: label(labels.bot),
          groupName: (name) => (name === null ? null : label(labels.group)(name)),
        }),
      ),
    });
  if (procedure === "search/query")
    return fields(result, {
      hits: list((value) => {
        const hit = value as { kind?: string; groupId?: string };
        return fields(value, {
          botName: label(labels.bot),
          groupName: label(labels.group),
          ...(hit.kind === "conversation" || hit.kind === "message"
            ? { title: label(hit.groupId ? labels.group : labels.bot) }
            : {}),
          ...(hit.kind === "routine" ? { title: label(labels.routine) } : {}),
        });
      }),
    });
  if (procedure === "computer/status")
    return fields(result, {
      busyBotName: (name) => (name === null ? null : label(labels.bot)(name)),
    });
  return result;
}
