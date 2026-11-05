import type { OrganizationList } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { SPACE_ID } from "../storybook/fixtures";
import { OrganizationSettingsPanel } from "./OrganizationSettingsPanel";

const personal: OrganizationList["organizations"][number] = {
  id: "org-1",
  name: "Personal",
  defaultSpaceId: SPACE_ID,
  spaceIds: [SPACE_ID],
  canManage: true,
};

const work: OrganizationList["organizations"][number] = {
  id: "org-2",
  name: "Harbor Studio",
  defaultSpaceId: "space-2",
  spaceIds: ["space-2"],
  canManage: true,
};

const organizations = (activeOrganizationId: string, list: OrganizationList["organizations"]) =>
  api({ organizations: { list: { activeOrganizationId, organizations: list } } });

const meta = {
  title: "Settings/Organization",
  component: OrganizationSettingsPanel,
  parameters: { layout: "padded" },
  args: { onBusyChange: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OrganizationSettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Owner: Story = {};

export const OwnerOfSeveral: Story = {
  parameters: { api: organizations(work.id, [personal, work]) },
};

export const Member: Story = {
  parameters: { api: organizations(work.id, [personal, { ...work, canManage: false }]) },
};

export const ConfirmDelete: Story = {
  parameters: OwnerOfSeveral.parameters,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Delete organization" }));
  },
};
