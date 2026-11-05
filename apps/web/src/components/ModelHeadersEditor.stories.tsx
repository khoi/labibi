import type { ModelHeaderRow } from "@labradoodle/contracts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { fn } from "storybook/test";
import { ModelHeadersEditor } from "./ModelHeadersEditor";

const meta = {
  title: "Settings/Model headers",
  component: ModelHeadersEditor,
  parameters: { layout: "padded" },
  args: { rows: [], onChange: fn() },
  render: function Render(args) {
    const [, updateArgs] = useArgs();
    return (
      <div className="max-w-md">
        <ModelHeadersEditor
          {...args}
          onChange={(rows: ModelHeaderRow[]) => {
            updateArgs({ rows });
            args.onChange(rows);
          }}
        />
      </div>
    );
  },
} satisfies Meta<typeof ModelHeadersEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithHeaders: Story = {
  args: {
    rows: [
      { name: "X-Team-Id", value: "team-42" },
      { name: "X-Request-Source", value: "settings" },
    ],
  },
};

export const SavedHeaders: Story = {
  args: { rows: null, savedNames: ["X-Api-Key", "X-Team-Id"] },
};

export const Full: Story = {
  args: {
    rows: Array.from({ length: 8 }, (_, index) => ({
      name: `X-Header-${index + 1}`,
      value: `value-${index + 1}`,
    })),
  },
};

export const Disabled: Story = {
  args: { rows: [{ name: "X-Team-Id", value: "team-42" }], disabled: true },
};
