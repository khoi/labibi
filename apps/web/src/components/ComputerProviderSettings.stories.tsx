import type {
  ComputerProviderDescriptor,
  ComputerProviderSettings as Settings,
} from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { ComputerProviderSettings } from "./ComputerProviderSettings";

const CLOUD: ComputerProviderDescriptor = {
  id: "example-cloud",
  displayName: "Example Cloud",
  capabilities: { perAccount: false },
  fields: [
    { key: "apiUrl", label: "API URL", kind: "url", required: true },
    { key: "apiToken", label: "API token", kind: "secret", required: true, destination: "apiUrl" },
    {
      key: "region",
      label: "Region",
      kind: "select",
      required: true,
      options: [
        { value: "eu-1", label: "Europe" },
        { value: "us-1", label: "North America" },
      ],
    },
  ],
};

const DESKTOP: ComputerProviderDescriptor = {
  id: "example-desktop",
  displayName: "Example Desktop",
  capabilities: { perAccount: true },
  fields: [
    { key: "desktopId", label: "Desktop ID", kind: "text", required: true },
    { key: "mcpUrl", label: "Gateway URL", kind: "url", required: true },
    {
      key: "mcpToken",
      label: "Gateway token",
      kind: "secret",
      required: true,
      destination: "mcpUrl",
    },
  ],
};

const DEPLOYMENT: Settings = {
  provider: "example-cloud",
  defaultProvider: "local",
  providers: [CLOUD, DESKTOP],
  values: { apiUrl: "https://computers.example.test", region: "eu-1" },
  savedSecrets: { apiToken: true },
};

const ACCOUNT: Settings = {
  provider: "example-desktop",
  defaultProvider: "local",
  providers: [DESKTOP],
  values: { desktopId: "ada-desktop", mcpUrl: "https://gateway.example.test/mcp" },
  savedSecrets: { mcpToken: true },
};

const meta = {
  title: "Settings/Computer provider",
  component: ComputerProviderSettings,
  parameters: {
    layout: "padded",
    api: api({
      computerProvider: {
        get: DEPLOYMENT,
        update: (input) => ({ ...DEPLOYMENT, ...input }),
        account: { get: ACCOUNT, update: (input) => ({ ...ACCOUNT, ...input }) },
      },
    }),
  },
  args: { scope: "deployment", onProviderChange: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ComputerProviderSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Deployment: Story = {};

export const Account: Story = { args: { scope: "account" } };

export const DeploymentDefault: Story = {
  parameters: {
    api: api({
      computerProvider: {
        get: { ...DEPLOYMENT, provider: "default", values: {}, savedSecrets: {} },
      },
    }),
  },
};

export const Saving: Story = {
  parameters: { api: api({ computerProvider: { update: () => new Promise(() => {}) } }) },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Save" }));
  },
};

export const SaveError: Story = {
  parameters: {
    api: api({
      computerProvider: {
        update: () => {
          throw new ORPCError("BAD_REQUEST", { message: "The API token was rejected." });
        },
      },
    }),
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Save" }));
  },
};

export const LoadError: Story = {
  parameters: {
    api: api({
      computerProvider: {
        get: () => {
          throw new ORPCError("FORBIDDEN", { message: "Only the deployment owner can see this." });
        },
      },
    }),
  },
};
