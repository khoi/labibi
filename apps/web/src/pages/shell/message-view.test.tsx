// @vitest-environment jsdom
import type { ThreadMessage } from "@labradoodle/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rpc } from "../../lib/rpc";
import { MessageView } from "./message-view";

const skills = vi.hoisted(() => ({
  updateDraft: vi.fn(async () => ({})),
  save: vi.fn(async () => ({})),
  testRun: vi.fn(async () => ({ runId: "run" })),
}));
vi.mock("../../lib/rpc", () => ({ rpc: { skills, artifacts: { get: vi.fn() } } }));

vi.mock("@lingui/core/macro", () => ({
  plural: (count: number, forms: { one: string; other: string }) =>
    (count === 1 ? forms.one : forms.other).replace("#", String(count)),
}));

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values),
  }),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type PeerBot = ComponentProps<typeof MessageView>["peerBot"];
const existingBot: PeerBot = () => ({ color: "orange" });

function renderView(
  role: ThreadMessage["role"],
  blocks: ThreadMessage["blocks"],
  props: Partial<ComponentProps<typeof MessageView>> = {},
) {
  const message: ThreadMessage = {
    id: "message",
    threadId: "thread",
    seq: 1,
    role,
    createdAt: new Date().toISOString(),
    blocks,
  };
  act(() =>
    root.render(
      <MessageView
        rpc={rpc}
        artifactTarget={{ botId: "parent" }}
        canAnswer={false}
        canDismiss={false}
        message={message}
        onAnswer={vi.fn()}
        peerBot={existingBot}
        onRefresh={vi.fn()}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={false}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
        {...props}
      />,
    ),
  );
}

it("keeps an edit made after a save when the saved status arrives late", async () => {
  const draft = {
    kind: "skill_draft" as const,
    skillId: "skill",
    name: "Weekly report",
    goal: "Send the weekly report",
    playbook: {
      whenToUse: "Fridays",
      inputs: [],
      steps: ["Collect"],
      howToCheck: "",
      whatToReturn: "",
      approvalBoundaries: "",
      failureHandling: "",
    },
    status: "draft" as const,
  };
  const render = (block: typeof draft | (Omit<typeof draft, "status"> & { status: "saved" })) =>
    root.render(
      <MessageView
        rpc={rpc}
        artifactTarget={{ botId: "parent" }}
        canAnswer={false}
        canDismiss={false}
        message={{
          id: "message",
          threadId: "thread",
          seq: 1,
          role: "bot",
          createdAt: new Date().toISOString(),
          blocks: [block],
        }}
        onAnswer={vi.fn()}
        peerBot={existingBot}
        onRefresh={() => Promise.reject(new Error("offline"))}
        onBotChanged={vi.fn()}
        onAddRoutine={vi.fn()}
        voiceReady={false}
        speaking={false}
        onSpeak={vi.fn()}
        onOpenComputer={vi.fn()}
        showToolActivity={false}
        onReply={vi.fn()}
        onMarkUnread={vi.fn()}
        onReact={vi.fn()}
      />,
    );
  act(() => render(draft));
  const card = container.querySelector('[data-testid="skill-draft-card"]')!;
  const button = () => card.querySelector("button")!;
  await act(async () => button().click());
  expect(button().textContent).toBe("Saved");

  const input = card.querySelector("input")!;
  const type = (value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  type("Edited");
  act(() => render({ ...draft, status: "saved" }));

  expect(input.value).toBe("Edited");
  expect(button().textContent).toBe("Save");

  // A different skill always loads its own fields.
  act(() => render({ ...draft, skillId: "other", name: "Other" }));
  expect(card.querySelector("input")!.value).toBe("Other");

  // A second save is not undone when the first save's status arrives after it.
  await act(async () => button().click());
  type("Newer");
  await act(async () => button().click());
  act(() => render({ ...draft, skillId: "other", name: "Other", status: "saved" }));
  expect(input.value).toBe("Newer");
  expect(button().textContent).toBe("Saved");
});

const ana = { id: "user-a", name: "Ana" };
const authored: ThreadMessage = {
  id: "message",
  threadId: "thread",
  seq: 1,
  role: "user",
  author: ana,
  blocks: [{ kind: "text", text: "Book the table" }],
  createdAt: new Date().toISOString(),
};

function renderAuthored(message: ThreadMessage, meId = "user-b") {
  renderView(message.role, message.blocks, { message, meId });
  const bubble = container.querySelector<HTMLElement>('[data-testid="message-user-bubble"]');
  if (!bubble?.parentElement) throw new Error("user bubble missing");
  return { bubble, row: bubble.parentElement };
}

it("names someone else's message and keeps it on the people side", () => {
  const { bubble, row } = renderAuthored(authored);

  expect(container.textContent).toBe("AnaBook the table");
  expect(row.className).toContain("justify-end");
  expect(bubble.className).toContain("bg-muted");
  expect(bubble.className).not.toContain("bg-chat-user");
});

it("keeps my own message unnamed on the right", () => {
  const { bubble, row } = renderAuthored(authored, ana.id);

  expect(container.textContent).toBe("Book the table");
  expect(row.className).toContain("justify-end");
  expect(bubble.className).toContain("bg-chat-user");
});

it("names the person a reply quotes instead of saying You", () => {
  renderAuthored({
    ...authored,
    author: undefined,
    replyToMessageId: "parent",
    replyPreview: { role: "user", author: ana, text: "Find us a restaurant" },
  });

  expect(container.querySelector('[data-testid="reply-parent-preview"]')?.textContent).toContain(
    "Ana: Find us a restaurant",
  );
});

it("speaks the message it renders", () => {
  const onSpeak = vi.fn();
  renderView("bot", [{ kind: "text", text: "Hello" }], { onSpeak, voiceReady: true });
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "Speak",
  );
  act(() => button?.click());
  expect(onSpeak).toHaveBeenCalledTimes(1);
  expect(onSpeak.mock.calls[0]?.[0]).toMatchObject({ id: "message" });
});

it("sends a settings Undo through the chat's space client", async () => {
  const spaceRpc = { bots: { update: vi.fn(async () => ({})) } };
  renderView(
    "bot",
    [
      {
        kind: "ask",
        text: "Settings updated",
        status: "answered",
        settingsUpdate: {
          botId: "bot-1",
          before: { modelProvider: null, modelId: null, thinkingLevel: null },
          after: { modelProvider: "google", modelId: "gemini-3.8-flash", thinkingLevel: "high" },
        },
      },
    ],
    { rpc: spaceRpc as never },
  );
  const undo = [...container.querySelectorAll("button")].find((b) => b.textContent === "Undo");
  await act(async () => undo?.click());
  expect(spaceRpc.bots.update).toHaveBeenCalledTimes(1);
});
