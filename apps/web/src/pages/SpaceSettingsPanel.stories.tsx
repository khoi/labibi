import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { SpaceSettingsPanel } from "./SpaceSettingsPanel";

const meta = {
  title: "Settings/Space",
  component: SpaceSettingsPanel,
  parameters: {
    layout: "padded",
    api: api({ spaceSettings: { overrides: [] } }),
  },
  args: {
    space: { id: "space-2", name: "Support", canRename: true, canDelete: true, botCount: 3 },
    onRename: fn(async () => {}),
    onDelete: fn(async () => {}),
    onLeft: fn(),
    onClose: fn(),
    onBusyChange: fn(),
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpaceSettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Owner: Story = {};

export const Member: Story = {
  args: { space: { id: "space-2", name: "Support", canRename: false, canDelete: false } },
};

export const DefaultSpace: Story = {
  args: { space: { id: "space-1", name: "Personal", canRename: true, canDelete: false } },
};

export const ConfirmDelete: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Delete space" }));
  },
};
