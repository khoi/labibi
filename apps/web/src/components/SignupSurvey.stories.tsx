import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { api } from "../storybook/api";
import { SignupSurvey } from "./SignupSurvey";

const meta = {
  title: "Account/Signup survey",
  component: SignupSurvey,
  parameters: { layout: "padded", api: api({ onboarding: { signupSurvey: { ok: true } } }) },
  args: { onDone: fn() },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-md py-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SignupSurvey>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Blank: Story = {};

export const ForWork: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Work" }));
    await userEvent.type(canvas.getByLabelText("How did you hear about us?"), "A friend");
  },
};
