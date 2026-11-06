import { createCipheriv, createHash } from "node:crypto";
import { BUILTIN_TOOL_NAMES } from "@labradoodle/contracts";
import { describe, expect, it } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";
import { inferScript, ScriptedAgentRuntime } from "./scripted-runtime.js";
import { EncryptedSecretStore } from "./secrets.js";

describe("secret store", () => {
  it("round-trips and never stores plaintext in ciphertext", async () => {
    const store = new EncryptedSecretStore("test-key");
    const record = await store.put("sk-or-v1-secretvalue", {
      operationId: "1",
      traceId: "1",
      spaceId: "w",
      userId: "u",
      signal: new AbortController().signal,
    });
    expect(record.ciphertext).not.toContain("sk-or-v1-secretvalue");
    expect(record.ciphertext).toMatch(/^v2:/);
    await expect(store.load(record.ciphertext, record.id)).resolves.toBe("sk-or-v1-secretvalue");
    await expect(store.load(record.ciphertext, "another-row")).rejects.toThrow();
  });

  it("keeps legacy ciphertext readable without rewriting it at startup", async () => {
    const key = "legacy-test-key";
    const iv = Buffer.alloc(12, 7);
    const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(key).digest(), iv);
    const encrypted = Buffer.concat([cipher.update("legacy-secret", "utf8"), cipher.final()]);
    const legacy = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
    const store = new EncryptedSecretStore(key);
    expect(await store.load(legacy, "secret-row")).toBe("legacy-secret");
  });

  it("rejects malformed v2 ciphertext when loading asynchronously", async () => {
    const store = new EncryptedSecretStore("test-key");
    await expect(store.load("v2:AAAA", "secret-row")).rejects.toThrow(
      "Encrypted secret is malformed",
    );
  });
});

describe("scripted runtime", () => {
  it("requests takeover for login work", () => {
    const script = inferScript("install the cli and sign in");
    expect(script?.some((t) => t.takeover)).toBe(true);
  });

  it("resumes after takeover without asking again", () => {
    const script = inferScript("install the cli and sign in", "takeover");
    expect(script?.some((t) => t.takeover)).toBe(false);
    expect(script?.some((t) => t.complete)).toBe(true);
  });

  it("resumes a skipped takeover without treating login as done", () => {
    const script = inferScript("install the cli and sign in", "takeover-skipped");
    expect(script?.some((t) => t.takeover)).toBe(false);
    expect(script?.some((t) => t.assistant?.includes("login was skipped"))).toBe(true);
  });

  it("does not infer a takeover checkpoint from ordinary task text", () => {
    const script = inferScript("ask me whether to record 'skipped the login'");
    expect(script?.some((t) => t.assistant?.includes("decision"))).toBe(true);
    expect(script?.some((t) => t.assistant?.includes("login was skipped"))).toBe(false);
  });

  it("routes destination/crm work through the connector", () => {
    const script = inferScript("write this to the destination crm as a note");
    expect(script?.some((t) => t.toolCalls?.some((c) => c.name === "destination.write"))).toBe(
      true,
    );
  });

  it("runs an in-thread subagent", () => {
    const script = inferScript("run a subagent to summarize the notes");
    expect(script?.some((t) => t.toolCalls?.some((c) => c.name === "run_subagent"))).toBe(true);
  });

  it("asks when it needs a decision", () => {
    const script = inferScript("ask me which city to use");
    expect(script?.some((t) => t.ask?.text.toLowerCase().includes("city"))).toBe(true);
  });

  it("stops hang work when aborted", async () => {
    const runtime = new ScriptedAgentRuntime();
    const ctx = {
      operationId: "1",
      traceId: "1",
      spaceId: "w",
      userId: "u",
      signal: new AbortController().signal,
    };
    const types: string[] = [];
    const iterating = (async () => {
      for await (const event of runtime.run(
        {
          botId: "b",
          threadId: "t",
          runId: "hang-1",
          prompt: "keep working until I stop you",
          instructions: "",
          history: [],
          tools: [],
          model: { provider: "scripted", id: "scripted" },
        },
        ctx,
      )) {
        types.push(event.type);
        if (event.type === "progress") await runtime.abort("hang-1");
      }
    })();
    await iterating;
    expect(types).toContain("progress");
    expect(types.at(-1)).toBe("done");
  });

  it("attaches a workspace file into the thread", () => {
    const script = inferScript("write notes/result.txt and attach it to the thread");
    expect(script?.some((t) => t.toolCalls?.some((c) => c.name === "write_file"))).toBe(true);
    expect(script?.some((t) => t.toolCalls?.some((c) => c.name === "attach_file"))).toBe(true);
  });

  it("observes the screen when asked", () => {
    const script = inferScript("observe your screen and type writer-desk");
    expect(script?.some((t) => t.toolCalls?.some((c) => c.name === "computer_observe"))).toBe(true);
    expect(
      script?.some((t) =>
        t.toolCalls?.some(
          (c) =>
            c.name === "computer_act" &&
            Array.isArray(c.args.actions) &&
            c.args.actions.some(
              (action) =>
                action &&
                typeof action === "object" &&
                "kind" in action &&
                "text" in action &&
                action.kind === "type" &&
                action.text === "writer-desk",
            ),
        ),
      ),
    ).toBe(true);
  });
});

describe("builtin tools", () => {
  it("exposes the tools the executor actually applies", async () => {
    expect([...BUILTIN_TOOL_NAMES].sort()).toEqual(
      builtinAgentTools.map((tool) => tool.name).sort(),
    );
    const options = {
      graphicalToolsAllowed: true,
      soloChat: true,
      trigger: "user",
      semanticMemoryEnabled: true,
      cloudAgentEnabled: true,
      historyRetrievalEnabled: true,
      voiceCall: true,
    };
    const enabled = selectBuiltinToolsForRun(options).map((tool) => tool.name);
    const purchaseNames = ["request_purchase", "purchase_status", "paid_request"];
    expect(enabled.filter((name) => purchaseNames.includes(name))).toEqual([]);
    expect(
      selectBuiltinToolsForRun({ ...options, paymentWalletEnabled: true })
        .map((tool) => tool.name)
        .filter((name) => purchaseNames.includes(name)),
    ).toEqual(purchaseNames);
  });
});
