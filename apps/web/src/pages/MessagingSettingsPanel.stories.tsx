import type {
  ExternalConversation,
  MessagingAgentConnection,
  MessagingChannelMembership,
  MessagingStatus,
  SpaceNavigation,
} from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { api } from "../storybook/api";
import { BOTS, CHIEF, GROUP, NOW, SCOUT, SPACE, SPACE_ID } from "../storybook/fixtures";
import { MessagingSettingsPanel } from "./MessagingSettingsPanel";

const PROVIDER = "example-chat";

const unlinked: MessagingStatus = {
  enabled: true,
  providers: [PROVIDER],
  openSignup: false,
  identities: [],
};

const linked: MessagingStatus = {
  ...unlinked,
  addresses: { [PROVIDER]: "+1 555 0100" },
  identities: [
    {
      id: "identity-1",
      provider: PROVIDER,
      address: "+1 555 0142",
      botId: CHIEF.id,
      botName: CHIEF.name,
    },
    {
      id: "identity-2",
      provider: PROVIDER,
      address: "@ada.park",
      botId: SCOUT.id,
      botName: SCOUT.name,
    },
  ],
};

const channels: MessagingChannelMembership[] = [
  {
    id: "membership-1",
    channelId: "channel-1",
    identityId: "identity-1",
    provider: PROVIDER,
    name: "Book club",
    status: "invited",
    memberCount: 6,
  },
  {
    id: "membership-2",
    channelId: "channel-2",
    identityId: "identity-2",
    provider: PROVIDER,
    name: "Family plans",
    status: "approved",
    memberCount: 4,
  },
];

const connections: MessagingAgentConnection[] = [
  {
    id: "connection-1",
    peerBotName: "Planner",
    peerOwnerLabel: "Lee Moreno",
    status: "pending",
    incoming: true,
  },
  {
    id: "connection-2",
    peerBotName: "Concierge",
    peerOwnerLabel: "Sam Ito",
    status: "approved",
    incoming: false,
  },
];

const conversation: ExternalConversation = {
  id: "external-1",
  spaceId: SPACE_ID,
  botId: CHIEF.id,
  provider: PROVIDER,
  displayName: "Weekend trip",
  participantNames: ["Ada Park", "Lee Moreno"],
  teamChatAmbientEnabled: null,
  teamChatRules: null,
  automatedSenderPolicies: {},
  automatedSenders: [],
  threadId: "thread-external-1",
  preview: "Lee: Saturday works for me.",
  unread: false,
  updatedAt: NOW,
};

function navigation(externalConversations: ExternalConversation[]): SpaceNavigation {
  return {
    current: {
      id: SPACE_ID,
      name: SPACE.name,
      bots: BOTS,
      groups: [GROUP],
      externalConversations,
      botSections: [],
    },
    spaces: [SPACE],
  };
}

const meta = {
  title: "Settings/Messaging",
  component: MessagingSettingsPanel,
  parameters: {
    layout: "padded",
    api: api({
      bots: { list: BOTS },
      spaces: { list: navigation([]) },
      messaging: {
        status: unlinked,
        channels: { list: [] },
        connections: { list: [] },
        installations: { list: { available: false, installations: [] } },
        link: { start: { code: "KX7P-2Q9M", expiresAt: "2099-01-01T00:00:00.000Z" } },
      },
    }),
  },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessagingSettingsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotLinked: Story = {};

export const Linked: Story = {
  parameters: {
    api: api({
      spaces: { list: navigation([conversation]) },
      messaging: {
        status: linked,
        channels: { list: channels },
        connections: { list: connections },
      },
    }),
  },
};

export const WorkspaceAvailable: Story = {
  parameters: {
    api: api({
      messaging: { installations: { list: { available: true, installations: [] } } },
    }),
  },
};

export const LoadError: Story = {
  parameters: {
    api: api({
      messaging: {
        status: () => {
          throw new ORPCError("FORBIDDEN", { message: "Messaging is turned off" });
        },
      },
    }),
  },
};
