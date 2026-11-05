import type { SpaceMember, SpaceMembers } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { SESSION, USER_ID } from "../storybook/fixtures";
import { SpaceMembersSettings } from "./SpaceMembersSettings";

const OWNER: SpaceMember = {
  userId: USER_ID,
  name: SESSION.user.name,
  email: SESSION.user.email,
  image: null,
  role: "owner",
};

const MEMBERS: SpaceMember[] = [
  OWNER,
  {
    userId: "user-2",
    name: "Noor Haddad",
    email: "noor@example.test",
    image: null,
    role: "member",
  },
  { userId: "user-3", name: "", email: "sam.reyes@example.test", image: null, role: "member" },
];

const list = (members: Partial<SpaceMembers>): SpaceMembers => ({
  spaceName: "Support",
  members: MEMBERS,
  canManage: true,
  openInvites: 0,
  ...members,
});

const meta = {
  title: "Settings/Space members",
  component: SpaceMembersSettings,
  parameters: {
    layout: "padded",
    api: api({
      spaces: {
        members: { list: list({}), remove: { ok: true } },
        invites: {
          create: {
            url: "http://localhost/invite/story-invite-token",
            expiresAt: "2026-11-02T09:00:00.000Z",
          },
          cancel: { ok: true },
        },
      },
    }),
  },
  args: { space: { id: "space-2", name: "Support" }, onLeft: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpaceMembersSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Owner: Story = {};

export const InvitesPending: Story = {
  parameters: { api: api({ spaces: { members: { list: list({ openInvites: 2 }) } } }) },
};

export const NewInviteLink: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole("button", { name: "Invite" }));
    await canvas.findByRole("textbox", { name: "Invite link" });
  },
};

export const Member: Story = {
  parameters: {
    api: api({
      spaces: {
        members: {
          list: list({
            canManage: false,
            members: [
              { ...OWNER, userId: "user-2", name: "Noor Haddad", email: "noor@example.test" },
              { ...OWNER, role: "member" },
            ],
          }),
        },
      },
    }),
  },
};

export const JustYou: Story = {
  parameters: { api: api({ spaces: { members: { list: list({ members: [OWNER] }) } } }) },
};

export const LoadFailed: Story = {
  parameters: {
    api: api({
      spaces: {
        members: {
          list: () => {
            throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Members are unavailable." });
          },
        },
      },
    }),
  },
};
