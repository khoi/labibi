import { Button, OptionSelect, Switch } from "@labradoodle/ui-web";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SETTINGS_CONTENT_WIDTH, SettingsGroup, SettingsRow } from "./SettingsRows";

const meta = {
  title: "Primitives/Settings rows",
  component: SettingsGroup,
  parameters: { layout: "padded" },
  args: {
    title: "Notifications",
    children: (
      <>
        <SettingsRow
          label="Desktop alerts"
          control={<Switch defaultChecked aria-label="Desktop alerts" />}
        />
        <SettingsRow label="Sound" control={<Switch aria-label="Sound" />} />
        <SettingsRow
          label="Quiet hours"
          control={
            <OptionSelect
              aria-label="Quiet hours"
              className="w-40"
              value="night"
              onValueChange={() => {}}
              options={[
                { value: "off", label: "Off" },
                { value: "night", label: "10 PM to 7 AM" },
              ]}
            />
          }
        />
      </>
    ),
  },
  decorators: [
    (Story) => (
      <div className={SETTINGS_CONTENT_WIDTH}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SettingsGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Group: Story = {};

export const Untitled: Story = {
  args: {
    title: undefined,
    children: (
      <>
        <SettingsRow
          label="Language"
          control={<span className="text-sm text-muted-foreground">English</span>}
        />
        <SettingsRow
          label="Time zone"
          control={<span className="text-sm text-muted-foreground">Europe/Berlin</span>}
        />
      </>
    ),
  },
};

export const RowWithDetail: Story = {
  args: {
    title: "Data",
    children: (
      <>
        <SettingsRow
          label="Export account data"
          control={
            <Button variant="outline" size="sm">
              Export
            </Button>
          }
        >
          <p className="mt-1 text-[13px] text-muted-foreground">
            A zip with your bots, chats and files, ready in a few minutes.
          </p>
        </SettingsRow>
        <SettingsRow label="Label only" />
      </>
    ),
  },
};
