import type { Meta, StoryObj } from "@storybook/react-vite";
import { SandboxedHtmlViewer } from "./SandboxedHtmlViewer";

const REPORT = `<!doctype html>
<html>
<head>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 32px; }
  table { border-collapse: collapse; margin-top: 16px; }
  th, td { border-bottom: 1px solid silver; padding: 6px 16px 6px 0; text-align: left; }
</style>
</head>
<body>
  <h1>Q3 summary</h1>
  <p>Revenue grew while churn held steady. Details below.</p>
  <table>
    <tr><th>Month</th><th>Revenue</th><th>Churn</th></tr>
    <tr><td>July</td><td>$41,200</td><td>2.1%</td></tr>
    <tr><td>August</td><td>$43,900</td><td>2.0%</td></tr>
    <tr><td>September</td><td>$46,300</td><td>2.2%</td></tr>
  </table>
</body>
</html>`;

const COUNTER = `<!doctype html>
<html>
<body style="font: 15px system-ui, sans-serif; margin: 32px">
  <button id="add" style="font: inherit; padding: 6px 14px">Add one</button>
  <p>Clicked <span id="count">0</span> times</p>
  <a href="https://example.test">Links do not leave the frame</a>
  <script>
    let count = 0;
    document.getElementById("add").addEventListener("click", () => {
      count += 1;
      document.getElementById("count").textContent = String(count);
    });
  </script>
</body>
</html>`;

const meta = {
  title: "Viewers/HTML viewer",
  component: SandboxedHtmlViewer,
  parameters: { layout: "padded" },
  args: { html: REPORT, title: "Q3 summary" },
  decorators: [
    (Story) => (
      <div className="h-[480px] overflow-hidden rounded-xl border border-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SandboxedHtmlViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Report: Story = {};

export const Interactive: Story = { args: { html: COUNTER, title: "Counter" } };
