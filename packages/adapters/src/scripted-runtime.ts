import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@labradoodle/adapter-kit";
import {
  APPROVED_ACTION_NOT_RUN_ERROR,
  abortableDelay,
  MODEL_CONTEXT_TOO_SMALL_ERROR,
  MODEL_OUTPUT_CUT_ERROR,
  MODEL_REQUEST_LIMIT_ERROR,
  modelFallbackFailure,
  STEERING_CONTINUATION_PROMPT,
} from "@labradoodle/core";

const running = new Map<string, AbortController>();

export class ScriptedAgentRuntime implements AgentRuntime {
  describe() {
    return {
      id: "scripted",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { streaming: true, compaction: false, tools: true, scripted: true },
    };
  }

  async abort(runId: string): Promise<void> {
    running.get(runId)?.abort();
  }

  async *run(
    request: AgentRunRequest,
    context?: Partial<AdapterContext>,
  ): AsyncIterable<AgentRuntimeEvent> {
    const controller = new AbortController();
    running.set(request.runId, controller);
    const signal = context?.signal ?? controller.signal;
    try {
      if (shouldFail(request.prompt)) {
        throw new Error(scriptedFailure(request.prompt));
      }
      // Like Pi, a run first takes the messages waiting for it. A continuation exists only to
      // answer them, so their text is its prompt; any other run keeps its own task. A resumed
      // attempt claims the same rows again, so it rebuilds the script it was running.
      const steering = (await request.claimSteering?.([])) ?? [];
      const steeredPrompt =
        request.prompt.includes(STEERING_CONTINUATION_PROMPT) && steering.length
          ? steering.map((item) => item.historyText ?? item.text).join("\n")
          : undefined;
      const prompt = steeredPrompt ?? request.prompt;
      // A run hangs on its own words: a reply without the message it quotes.
      const hangMs = hangDuration(prompt.replace(REPLY_CONTEXT, ""));
      if (hangMs !== undefined) {
        // Long-running work happens on the computer, which starts it like any real run would.
        yield {
          type: "tool",
          name: "list_files",
          args: { path: "" },
          executionId: `${request.runId}:list_files:hang`,
        };
        yield { type: "progress", text: "still working…", activity: true };
        const hangUntil = Date.now() + hangMs;
        while (!controller.signal.aborted && !signal.aborted && Date.now() < hangUntil) {
          await abortableDelay(50, controller.signal);
          if (controller.signal.aborted || signal.aborted) break;
          yield { type: "progress", text: "still working…", activity: true };
        }
        yield { type: "done", text: Number.isFinite(hangMs) ? "done." : "stopped" };
        return;
      }
      const script =
        steeredPrompt !== undefined
          ? inferScript(steeredPrompt, request.resumeFromCheckpoint)
          : (request.script ?? inferScript(request.prompt, request.resumeFromCheckpoint));
      // Per-run call index so repeated tools (e.g. message_agent) get distinct
      // executionIds — delivery keys and effect replays key off this value.
      let toolCallSeq = 0;
      for (const turn of script) {
        if (signal.aborted || controller.signal.aborted) {
          yield { type: "done", text: "stopped" };
          return;
        }
        if (turn.assistant) {
          yield { type: "progress", text: "working…", activity: true };
          yield { type: "text", text: turn.assistant };
        }
        for (const call of turn.toolCalls ?? []) {
          const executionId = `${request.runId}:${call.name}:${toolCallSeq++}`;
          if (call.name === "run_subagent") {
            const agentId = `${request.runId}:subagent`;
            const name = String(call.args.name ?? "helper");
            const task = String(call.args.task ?? request.prompt);
            yield {
              type: "subagent",
              agentId,
              name,
              task,
              status: "running",
              progress: "working…",
            };
            yield {
              type: "tool",
              name: call.name,
              args: call.args,
              executionId,
            };
            yield {
              type: "subagent",
              agentId,
              name,
              task,
              status: "completed",
              result: `done. i handled: ${task.slice(0, 180)}`,
            };
            continue;
          }
          yield {
            type: "tool",
            name: call.name,
            args: call.args,
            executionId,
          };
        }
        if (turn.ask) {
          yield {
            type: "ask",
            text: turn.ask.text,
            detail: turn.ask.detail,
            actions: turn.ask.actions,
          };
          return;
        }
        if (turn.takeover) {
          yield { type: "takeover", reason: turn.takeover.reason };
          return;
        }
        if (turn.complete) {
          yield {
            type: "usage",
            inputTokens: 12,
            outputTokens: 40,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            provider: "scripted",
            model: "scripted",
          };
          yield { type: "done", text: turn.assistant };
          return;
        }
      }
      yield { type: "text", text: "done." };
      yield { type: "done", text: "done." };
    } finally {
      controller.abort();
      running.delete(request.runId);
    }
  }
}

/** A JSON object written in a message, or undefined for anything else, malformed text included. */
function jsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export function inferScript(
  prompt: string,
  resumeFromCheckpoint?: string,
): NonNullable<AgentRunRequest["script"]> {
  // A reply opens with the quoted target; a generated id can contain a journey keyword by
  // chance ("crm" inside a cuid), so the branches key on the words alone.
  const words = prompt.replace(REPLY_CONTEXT, "");
  const lower = words.toLowerCase();
  // In a group the words open with the mention that picked this bot.
  const page = /^(?:@\S+\s+)?call save_page with (.+?)(?:\nthen say ([\s\S]+))?$/s.exec(
    words.trim(),
  );
  const pageArgs = page ? jsonObject(page[1]!) : undefined;
  if (page && pageArgs) {
    return [
      {
        assistant: page[2],
        toolCalls: [{ name: "save_page", args: pageArgs }],
        complete: true,
      },
    ];
  }
  if (lower.includes("can you check my gmail inbox?")) {
    return [
      {
        assistant: "Connect Gmail and I’ll check your inbox.",
        toolCalls: [{ name: "connect_app", args: { app: "gmail" } }],
        complete: true,
      },
    ];
  }
  if (lower.includes("silent routine fixture")) {
    return [
      {
        assistant: "Checking for changes.",
        toolCalls: [{ name: "list_files", args: { path: "" } }],
      },
      { assistant: "NO_RESPONSE", complete: true },
    ];
  }
  if (resumeFromCheckpoint === "takeover-skipped") {
    return [
      {
        assistant: "login was skipped. continuing without treating sign-in as done.",
        complete: true,
      },
    ];
  }
  if (resumeFromCheckpoint === "takeover") {
    return [
      {
        assistant:
          "signed in. the session stays in this computer — protected input never hit the thread.",
        complete: true,
      },
    ];
  }
  // Before every content-based intent so payload text cannot steal the branch.
  const shellCommand = /run the shell command\s+([\s\S]+)$/i.exec(prompt)?.[1]?.trim();
  if (shellCommand) {
    return [
      {
        assistant: "running it on my computer.",
        toolCalls: [{ name: "shell", args: { command: shellCommand } }],
        complete: true,
      },
    ];
  }
  if (lower.includes("run hostname on my computer")) {
    return [
      {
        assistant: "checking your computer's name.",
        toolCalls: [{ name: "user_computer_shell", args: { command: "hostname" } }],
        complete: true,
      },
    ];
  }
  const lookAt = /look at (.+?) on my computer/i.exec(prompt)?.[1]?.trim();
  if (lookAt) {
    return [
      {
        assistant: `looking at ${lookAt}.`,
        toolCalls: [{ name: "user_computer_observe", args: { app: lookAt } }],
        complete: true,
      },
    ];
  }
  const typeIn = /type "([^"]+)" in a new (.+?) document on my computer/i.exec(prompt);
  if (typeIn) {
    return [
      {
        assistant: `typing in ${typeIn[2]}.`,
        toolCalls: [
          {
            name: "user_computer_act",
            args: {
              app: typeIn[2],
              actions: [
                { kind: "menu", path: ["File", "New"] },
                { kind: "type", text: typeIn[1] },
              ],
            },
          },
        ],
        complete: true,
      },
    ];
  }
  if (
    lower.includes("launch a cloud agent") ||
    lower.includes("start a cloud agent") ||
    lower.includes("cloud coding agent")
  ) {
    return [
      {
        assistant: "launching a cloud agent for that.",
        toolCalls: [
          {
            name: "cloud_agent_launch",
            args: {
              prompt: "Add a README with setup instructions",
              repository: "https://github.com/example/demo",
              openPr: true,
            },
          },
        ],
        complete: true,
      },
    ];
  }
  if (lower.includes("show a login card")) {
    return [
      {
        assistant: "i need that sign-in in a protected card.",
        toolCalls: [
          {
            name: "request_secret",
            args: {
              label: "Example sign-in",
              purpose: "password",
              credential: {
                name: "example_login",
                origin: "https://login.example.test",
                auth: { type: "login" },
              },
            },
          },
        ],
      },
    ];
  }
  if (lower.includes("command variable secret card")) {
    return [
      {
        assistant: "i need that key in a protected field.",
        toolCalls: [
          {
            name: "request_secret",
            args: {
              label: "Deploy key",
              purpose: "api_key",
              credential: { name: "deploy-key", auth: { type: "command" } },
            },
          },
        ],
      },
    ];
  }
  if (
    lower.includes("masked secret card") ||
    lower.includes("show a secret card") ||
    lower.includes("request a masked api key")
  ) {
    return [
      {
        assistant: "i need that value in a protected field.",
        toolCalls: [
          {
            name: "request_secret",
            args: {
              label: "API key",
              purpose: "api_key",
              credential: {
                name: "example_api",
                origin: "https://api.example.test",
                auth: { type: "bearer" },
              },
            },
          },
        ],
      },
    ];
  }
  if (lower.includes("fetch approval card")) {
    return [
      {
        assistant: "i will read that page.",
        toolCalls: [
          { name: "web_fetch", args: { url: "https://docs.example.test/page?q=fixture" } },
        ],
      },
    ];
  }
  // The site is not in the message, so the owner did not name it and the call asks.
  const paidRequest = /paid request card(?: on (\w+))?/.exec(lower);
  if (paidRequest) {
    const url = `https://api.${paidRequest[1] ?? "example"}.test/quote`;
    return [
      {
        assistant: "i will call that paid api.",
        toolCalls: [
          {
            name: "paid_request",
            args: {
              url,
              method: "GET",
              reason:
                "The owner asked for a live price quote from this paid API, which answers only after a small per-request payment.",
            },
          },
        ],
      },
    ];
  }
  if (lower.includes("mcp approval card")) {
    return [
      {
        assistant: "i will register that server for your approval.",
        toolCalls: [
          {
            name: "add_mcp_server",
            args: {
              name: "Fixture MCP",
              transport: "stdio",
              command: "echo",
              assignToSelf: true,
            },
          },
        ],
      },
    ];
  }
  if (lower.includes("quote markdown fixture")) {
    const marker = /quote markdown fixture\s+(\S+)/i.exec(prompt)?.[1] ?? "md-fixture";
    return [
      {
        assistant: `${marker}
1. list-a
2. list-b

| k | v |
| --- | --- |
| cell-a | cell-b |
| cell-c | cell-d |

\`\`\`
code-a
---
code-b
\`\`\``,
        complete: true,
      },
    ];
  }
  const hasChoices =
    lower.includes("tappable choices") ||
    lower.includes("choice buttons") ||
    lower.includes("pick from these cities");
  if (
    hasChoices ||
    lower.includes("ask me") ||
    lower.includes("which city") ||
    lower.includes("need a decision")
  ) {
    // Background resumes retain the task and append the answered question.
    if (/\nAnswer:/.test(prompt)) {
      return [{ assistant: "thanks. done.", complete: true }];
    }
    return [
      {
        assistant: hasChoices ? "pick one to continue." : "i need a decision before i continue.",
        ask: hasChoices
          ? {
              text: "Which city should I use?",
              actions: [
                { id: "choice-1", label: "Berlin" },
                { id: "choice-2", label: "Seoul" },
                { id: "choice-3", label: "Toronto" },
                { id: "choice-4", label: "Lisbon" },
              ],
            }
          : { text: "Which city should I use?", detail: "Reply with one city name." },
      },
    ];
  }
  if (lower.includes("take over") || lower.includes("sign in") || lower.includes("login")) {
    return [
      { assistant: "i need you on the screen for a one-time sign-in. handing you the computer." },
      { takeover: { reason: "Sign in to continue. Protected input stays off the thread." } },
    ];
  }
  if (
    lower.includes("observe your screen") ||
    lower.includes("look at your screen") ||
    lower.includes("use your screen")
  ) {
    const typed = /type\s+([A-Za-z0-9._-]+)/i.exec(prompt)?.[1] ?? "ready";
    return [
      {
        assistant: "using my screen now.",
        toolCalls: [
          { name: "computer_observe", args: {} },
          {
            name: "computer_act",
            args: {
              actions: [{ kind: "type", text: typed }],
              observe: true,
            },
          },
        ],
        complete: true,
      },
    ];
  }
  const ownInstructions = /update your instructions to:\s*([^\n<&]+)/i.exec(prompt);
  if (ownInstructions) {
    return [
      {
        assistant: "updating my instructions.",
        toolCalls: [{ name: "update_bot", args: { instructions: ownInstructions[1]!.trim() } }],
        complete: true,
      },
    ];
  }
  if (
    lower.includes("silence finish notifications") ||
    lower.includes("turn off finish notifications")
  ) {
    return [
      {
        assistant: "silencing finish notifications.",
        toolCalls: [{ name: "update_bot", args: { notifyOnFinish: false } }],
        complete: true,
      },
    ];
  }
  if (
    lower.includes("resume finish notifications") ||
    lower.includes("turn on finish notifications")
  ) {
    return [
      {
        assistant: "enabling finish notifications.",
        toolCalls: [{ name: "update_bot", args: { notifyOnFinish: true } }],
        complete: true,
      },
    ];
  }
  if (lower.includes("subagent") || lower.includes("delegate to a helper")) {
    return [
      {
        assistant: "spinning up a helper for that.",
        toolCalls: [{ name: "run_subagent", args: { name: "helper", task: prompt } }],
        complete: true,
      },
    ];
  }
  if (lower.startsWith("run taught skill:") || lower.includes("this is a safe test")) {
    return [
      {
        assistant:
          "Running the taught skill using its saved playbook. I will follow the demonstrated steps and report the result.",
        complete: true,
      },
    ];
  }
  if (/^run\s+/.test(lower)) {
    return [
      {
        assistant:
          "Using the saved taught skill playbook for that request and following its steps.",
        complete: true,
      },
    ];
  }
  if (lower.includes("connector") || lower.includes("crm") || lower.includes("destination")) {
    return [
      {
        assistant: "writing the record through the connected destination.",
        toolCalls: [
          {
            name: "destination.write",
            args: { collection: "notes", title: "Labradoodle result", body: prompt },
          },
        ],
        complete: true,
      },
    ];
  }
  if (lower.includes("attach") && (lower.includes("thread") || lower.includes("into the thread"))) {
    const said = /says?\s+(.+)$/i.exec(prompt)?.[1]?.replace(/[.]+$/, "") ?? prompt;
    const content = `${said.trim()}\n`;
    const filePath =
      /(?:called|named|path|file)\s+([A-Za-z0-9._/-]+)/i.exec(prompt)?.[1] ?? "notes/result.txt";
    return [
      { assistant: "writing that into my home and attaching it to the thread." },
      { toolCalls: [{ name: "write_file", args: { path: filePath, content } }] },
      { toolCalls: [{ name: "attach_file", args: { path: filePath } }], complete: true },
    ];
  }
  if (
    lower.includes("save shared memory") ||
    lower.includes("update shared memory") ||
    lower.includes("write shared memory")
  ) {
    const contentMatch =
      /\b(?:with|content):\s*([\s\S]+)$/i.exec(prompt) ?? /\bwith\s+([\s\S]+)$/i.exec(prompt);
    const content = contentMatch?.[1]?.trim();
    const header = contentMatch ? prompt.slice(0, contentMatch.index) : prompt;
    const named =
      /(?:named|called|path|file)\s+([A-Za-z0-9._/-]+)/i.exec(header)?.[1] ??
      /shared memory\s+([A-Za-z0-9._/-]+\.[A-Za-z0-9]+)/i.exec(header)?.[1];
    const path = named && named.toLowerCase() !== "with" ? named : "MEMORY.md";
    if (!content) {
      return [
        {
          assistant:
            "say what to save, for example: save shared memory MEMORY.md with: the new facts.",
          complete: true,
        },
      ];
    }
    return [
      {
        assistant: "saving that to shared memory.",
        toolCalls: [{ name: "save_shared_memory", args: { path, content } }],
        complete: true,
      },
    ];
  }
  if (
    lower.includes("write") &&
    (lower.includes("file") || lower.includes("home") || lower.includes("note"))
  ) {
    const said = /says?\s+(.+)$/i.exec(prompt)?.[1]?.replace(/[.]+$/, "") ?? prompt;
    const content = `${said.trim()}\n`;
    const filePath =
      /(?:called|named)\s+([A-Za-z0-9._/-]+)/i.exec(prompt)?.[1] ?? "notes/result.txt";
    return [
      { toolCalls: [{ name: "write_file", args: { path: filePath, content } }] },
      { assistant: "writing that into my home now.", complete: true },
    ];
  }
  if (lower.includes("remember")) {
    return [
      {
        assistant: "noted — i will keep that in memory.",
        memory: [{ scope: "bot", path: "MEMORY.md", content: `# Memory\n\n- ${prompt}\n` }],
        complete: true,
      },
    ];
  }
  return [
    {
      assistant: `on it. i will work this in the background and come back with a result.\n\n${summarize(prompt)}`,
    },
    {
      files: [{ path: "notes/last-task.md", content: `# Task\n\n${prompt}\n` }],
      complete: true,
    },
  ];
}

function shouldFail(prompt: string): boolean {
  return prompt.toLowerCase().includes("fail this run");
}

/**
 * The error a failing run throws; "overloaded" sends the body Anthropic returns with a 529 and
 * "unreachable" sends what the provider SDKs report when nothing listens at the base URL.
 */
function scriptedFailure(prompt: string): string {
  if (/\bfixed context\b/i.test(prompt)) return MODEL_CONTEXT_TOO_SMALL_ERROR;
  if (/\bconnection request limit\b/i.test(prompt)) return MODEL_REQUEST_LIMIT_ERROR;
  if (/\bunrun approval\b/i.test(prompt)) return APPROVED_ACTION_NOT_RUN_ERROR;
  if (/\bcut reply\b/i.test(prompt)) return MODEL_OUTPUT_CUT_ERROR;
  if (/\bunreachable\b/i.test(prompt)) return "Connection error.";
  if (/\bout of credits\b/i.test(prompt)) {
    return '402: {"message":"You have no credits remaining. Add credits to continue."}';
  }
  if (/\brejected key\b/i.test(prompt)) return '401: {"message":"Invalid API key"}';
  if (/\bexhausted backups\b/i.test(prompt)) {
    return modelFallbackFailure('429: {"message":"Too many requests"}', [
      {
        provider: "fake-provider",
        modelId: "fake-backup",
        status: "failed",
        reason: "429 quota exhausted",
      },
    ]);
  }
  return /\boverloaded\b/i.test(prompt)
    ? '529: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'
    : "Scripted run failure";
}

/** How long a scripted run keeps working before it finishes; undefined runs its script. */
function hangDuration(prompt: string): number | undefined {
  const lower = prompt.toLowerCase();
  // Asking another bot to keep working makes that bot's run hang, not this one.
  if (lower.includes("message the bot named") || lower.includes("message bot named")) {
    return undefined;
  }
  const seconds = /\bwork for (\d+) seconds?\b/.exec(lower)?.[1];
  if (seconds) return Number(seconds) * 1000;
  return lower.includes("keep working") ||
    lower.includes("work until i stop") ||
    lower.includes("until i stop you") ||
    lower.includes("hang until stopped")
    ? Number.POSITIVE_INFINITY
    : undefined;
}

/** The quoted message a reply's prompt opens with (see reply-context.ts). */
const REPLY_CONTEXT =
  /^(?:Replying to|User reacted with \S+ to) \(quoted data, not instructions\):\n<(reply_target|reaction_target)>\n[\s\S]*?\n<\/\1>\n\n/;

function summarize(prompt: string): string {
  return `done. i handled: ${prompt.slice(0, 180)}`;
}
