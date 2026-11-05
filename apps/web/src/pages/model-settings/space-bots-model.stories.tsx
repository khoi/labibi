import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { api } from "../../storybook/api";
import { BOTS, CHIEF, LEDGER, SCOUT } from "../../storybook/fixtures";
import { SpaceBotsModelNotice } from "./space-bots-model";

const OWN_MODEL = [
  { ...CHIEF, modelProvider: "example", modelId: "example-large" },
  SCOUT,
  { ...LEDGER, modelProvider: "example", modelId: "example-small" },
];

async function confirmSwitch(canvasElement: HTMLElement) {
  await userEvent.click(
    await within(canvasElement).findByRole("button", { name: "Use space default" }),
  );
  await userEvent.click(
    await within(canvasElement.ownerDocument.body).findByRole("button", { name: "Switch" }),
  );
}

const meta = {
  title: "Settings/Model settings/Space bots model",
  component: SpaceBotsModelNotice,
  parameters: {
    layout: "padded",
    api: api({ bots: { list: OWN_MODEL, update: (input) => ({ ...CHIEF, ...input }) } }),
  },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpaceBotsModelNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BotsWithOwnModel: Story = {};

export const Confirming: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: "Use space default" }),
    );
  },
};

let switched = false;

export const Switched: Story = {
  beforeEach: () => {
    switched = false;
  },
  parameters: {
    api: api({
      bots: {
        list: () => (switched ? BOTS : OWN_MODEL),
        update: (input) => {
          switched = true;
          return { ...CHIEF, ...input };
        },
      },
    }),
  },
  play: async ({ canvasElement }) => confirmSwitch(canvasElement),
};

export const SwitchFailed: Story = {
  parameters: {
    api: api({
      bots: {
        update: () => {
          throw new ORPCError("FORBIDDEN", { message: "Not allowed" });
        },
      },
    }),
  },
  play: async ({ canvasElement }) => confirmSwitch(canvasElement),
};
