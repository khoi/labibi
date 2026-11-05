import type { Meta, StoryObj } from "@storybook/react-vite";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import type { ComponentProps } from "react";
import { useState } from "react";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "./input-otp.js";

const sixSlots = (
  <InputOTPGroup>
    {[0, 1, 2, 3, 4, 5].map((index) => (
      <InputOTPSlot key={index} index={index} />
    ))}
  </InputOTPGroup>
);

function Code(props: ComponentProps<typeof InputOTP>) {
  const [value, setValue] = useState(props.value ?? "");
  return (
    <div>
      <InputOTP {...props} value={value} onChange={setValue} />
    </div>
  );
}

const meta = {
  title: "Primitives/Input OTP",
  component: InputOTP,
  parameters: { layout: "centered" },
  args: {
    maxLength: 6,
    pattern: REGEXP_ONLY_DIGITS,
    "aria-label": "Sign-in code",
    children: sixSlots,
  },
  render: (args) => <Code key={args.value} {...args} />,
} satisfies Meta<typeof InputOTP>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Filled: Story = { args: { value: "482913" } };

export const Split: Story = {
  args: {
    value: "4829",
    children: (
      <>
        <InputOTPGroup>
          <InputOTPSlot index={0} />
          <InputOTPSlot index={1} />
          <InputOTPSlot index={2} />
        </InputOTPGroup>
        <InputOTPSeparator />
        <InputOTPGroup>
          <InputOTPSlot index={3} />
          <InputOTPSlot index={4} />
          <InputOTPSlot index={5} />
        </InputOTPGroup>
      </>
    ),
  },
};

export const Invalid: Story = {
  args: {
    value: "000000",
    children: (
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <InputOTPSlot key={index} index={index} aria-invalid />
        ))}
      </InputOTPGroup>
    ),
  },
};

export const Disabled: Story = { args: { value: "4829", disabled: true } };
