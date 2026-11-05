import type { MessageBlock } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { CHIEF, NOW } from "../storybook/fixtures";
import { McpAppCard } from "./McpAppCard";

type AppBlock = Extract<MessageBlock, { kind: "app" }>;

const APP_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; padding: 16px; font: 14px/1.45 system-ui, sans-serif; color: rgb(23 23 23); }
  body.dark { color: rgb(245 245 245); }
  .muted { color: rgb(115 115 115); }
  body.dark .muted { color: rgb(163 163 163); }
  h1 { margin: 0 0 2px; font-size: 16px; font-weight: 600; }
  ol { margin: 14px 0; padding: 0; list-style: none; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid rgb(128 128 128 / 0.2); }
  .actions { display: flex; gap: 8px; }
  button { font: inherit; padding: 6px 14px; border-radius: 999px; border: 1px solid rgb(128 128 128 / 0.35); background: transparent; color: inherit; cursor: pointer; }
</style>
</head>
<body>
<h1 class="title">Loading shipment</h1>
<div class="muted summary"></div>
<ol class="events"></ol>
<div class="actions">
  <button type="button" class="track">Track online</button>
  <button type="button" class="ask">Ask about delivery</button>
</div>
<script>
  let next = 1;
  const pending = new Map();
  const send = (message) => parent.postMessage(message, "*");
  const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = next++;
      pending.set(id, resolve);
      send({ jsonrpc: "2.0", id, method, params });
    });
  const theme = (context) => document.body.classList.toggle("dark", context && context.theme === "dark");
  const size = () => notify("ui/notifications/size-changed", { height: document.documentElement.scrollHeight });
  let order = "";
  const show = (result) => {
    const shipment = result.structuredContent || {};
    document.querySelector(".title").textContent = shipment.title || "Shipment";
    document.querySelector(".summary").textContent = shipment.summary || "";
    const list = document.querySelector(".events");
    list.replaceChildren(
      ...(shipment.events || []).map((event) => {
        const item = document.createElement("li");
        const what = document.createElement("span");
        const when = document.createElement("span");
        what.textContent = event.status;
        when.textContent = event.at;
        when.className = "muted";
        item.append(what, when);
        return item;
      }),
    );
  };
  addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
      return;
    }
    if (message.method === "ui/notifications/tool-input") order = message.params.arguments.order || "";
    if (message.method === "ui/notifications/tool-result") show(message.params);
    if (message.method === "ui/notifications/host-context-changed") theme(message.params);
    if (message.method === "ui/resource-teardown") send({ jsonrpc: "2.0", id: message.id, result: {} });
  });
  document.querySelector(".track").addEventListener("click", () =>
    request("ui/open-link", { url: "https://tracking.example.test/" + order }),
  );
  document.querySelector(".ask").addEventListener("click", () =>
    request("ui/message", { role: "user", content: [{ type: "text", text: "When will order " + order + " arrive?" }] }),
  );
  new ResizeObserver(size).observe(document.body);
  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "shipment-tracker", version: "1.0.0" },
    appCapabilities: {},
  }).then((result) => {
    theme(result && result.hostContext);
    notify("ui/notifications/initialized", {});
  });
</script>
</body>
</html>`;

const ARTIFACT = {
  id: "artifact-app-1",
  botId: CHIEF.id,
  groupId: null,
  runId: null,
  name: "shipment-tracker.html",
  description: null,
  mimeType: "text/html",
  size: APP_HTML.length,
  version: 1,
  createdAt: NOW,
  contentBase64: btoa(APP_HTML),
};

const events = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    status: index === 0 ? "Out for delivery" : `Scanned at sorting center ${count - index}`,
    at: `Oct ${26 - Math.floor(index / 3)}, ${String(9 + (index % 3) * 4).padStart(2, "0")}:00`,
  }));

const BLOCK: AppBlock = {
  kind: "app",
  artifactId: ARTIFACT.id,
  server: "Example Shipping",
  tool: "track_shipment",
  toolArguments: { order: "A-1042" },
  toolResult: {
    content: [{ type: "text", text: "Order A-1042 is out for delivery." }],
    structuredContent: {
      title: "Order A-1042",
      summary: "Arrives today by 6 pm",
      events: events(3),
    },
  },
};

const meta = {
  title: "Chat/MCP app card",
  component: McpAppCard,
  parameters: {
    layout: "padded",
    api: api({ artifacts: { get: ARTIFACT } }),
  },
  args: { block: BLOCK, target: { botId: CHIEF.id } },
} satisfies Meta<typeof McpAppCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};

export const Borderless: Story = {
  args: { block: { ...BLOCK, prefersBorder: false } },
};

export const TallApp: Story = {
  args: {
    block: {
      ...BLOCK,
      toolResult: {
        ...BLOCK.toolResult,
        structuredContent: {
          title: "Order A-1042",
          summary: "Every scan since it shipped",
          events: events(30),
        },
      },
    },
  },
};

export const Loading: Story = {
  parameters: { api: api({ artifacts: { get: () => new Promise(() => {}) } }) },
};
