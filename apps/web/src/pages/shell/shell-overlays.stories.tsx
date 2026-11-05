import type { AccountSecurity } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { api } from "../../storybook/api";
import { BOTS, CHIEF, GROUP, ME, message, SCOUT, SESSION, SPACE } from "../../storybook/fixtures";
import type { ShellOverlay } from "../shell-overlay";
import { AppOverlays, SettingsOverlays } from "./shell-overlays";

function SettingsOverlaysStory({
  overlay,
  peerConversation = null,
}: {
  overlay: ShellOverlay;
  peerConversation?: { peerBotId: string; peerBotName: string } | null;
}) {
  const queries = useSpaceQueries();
  return (
    <SettingsOverlays
      rpc={rpc}
      queries={queries}
      overlay={overlay}
      setOverlay={fn()}
      settingsSpace={SPACE}
      showSettings
      spaces={[SPACE]}
      renameSpace={fn(async () => undefined)}
      removeSpace={fn(async () => undefined)}
      leftSpace={fn(async () => undefined)}
      refreshSpaces={fn(async () => undefined)}
      openAgentImport={fn()}
      alive={{ current: true }}
      user={SESSION.user}
      refetchSession={fn(async () => undefined)}
      bootstrapMe={ME}
      setBootstrapMe={fn()}
      messagingEnabled={false}
      memoryConfig={null}
      peerConversation={peerConversation}
      setPeerConversation={fn()}
      active={CHIEF}
      peerBot={(botId) => BOTS.find((bot) => bot.id === botId)}
    />
  );
}

const accountSecurity: AccountSecurity = {
  hasPassword: true,
  freshOidcAuth: false,
  ssoLinked: false,
  emailDeletion: false,
  sso: null,
};

const meta = {
  title: "Shell/Shell overlays",
  component: AppOverlays,
  decorators: [
    (Story) => (
      <main className="min-h-screen bg-background">
        <Story />
      </main>
    ),
  ],
  parameters: {
    http: { "/api/devices": { devices: [] }, "/api/auth/account-security": accountSecurity },
    api: api({
      spaces: {
        list: {
          current: {
            id: SPACE.id,
            name: SPACE.name,
            bots: BOTS,
            groups: [GROUP],
            externalConversations: [],
            botSections: [],
          },
          spaces: [SPACE],
        },
      },
      capabilities: { list: [], catalogSearch: { enabled: false, results: [] } },
      marketplace: { catalog: { entries: [], unavailableRegistries: [], skippedEntries: 0 } },
      mcp: {
        servers: { list: [] },
        assignments: { all: [], list: [] },
      },
      bots: { list: BOTS },
      threads: {
        messages: {
          threadId: CHIEF.threadId,
          olderCursor: null,
          messages: [
            message("bot", [
              {
                kind: "bot_message_sent",
                toBotId: SCOUT.id,
                toBotName: SCOUT.name,
                text: "Can you pull three sources on churn?",
              },
            ]),
            message("system", [
              {
                kind: "bot_message_received",
                fromBotId: SCOUT.id,
                fromBotName: SCOUT.name,
                text: "Found three. The cancellation notes show the biggest change.",
              },
            ]),
          ],
        },
      },
    }),
  },
  args: {
    overlay: { kind: "integrations" },
    setOverlay: fn(),
    activeBotId: CHIEF.id,
    stdioEnabled: false,
    onConnectedAppsChange: fn(),
  },
} satisfies Meta<typeof AppOverlays>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Integrations: Story = {};

export const Skills: Story = { args: { overlay: { kind: "skills" } } };

export const McpServers: Story = { args: { overlay: { kind: "mcp" } } };

export const Settings: Story = {
  render: () => (
    <SettingsOverlaysStory overlay={{ kind: "settings", section: "general", spaceId: null }} />
  ),
};

export const PeerMessages: Story = {
  render: () => (
    <SettingsOverlaysStory
      overlay={null}
      peerConversation={{ peerBotId: SCOUT.id, peerBotName: SCOUT.name }}
    />
  ),
};
