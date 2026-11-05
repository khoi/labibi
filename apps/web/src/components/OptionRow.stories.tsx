import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { OptionRow, optionLetter } from "./OptionRow";

const answers = [
  "Send it Monday morning",
  "Hold it until the numbers are final",
  "Share a draft with the team first, then send the final version once everyone has signed off on the revenue and churn figures",
];

const meta = {
  title: "Primitives/Option row",
  component: OptionRow,
  parameters: { layout: "centered" },
  args: { letter: "A", children: answers[0], onClick: fn() },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OptionRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Selected: Story = { args: { selected: true } };

export const Disabled: Story = { args: { disabled: true } };

export const LongAnswer: Story = { args: { letter: "C", children: answers[2] } };

function Question({ onClick }: { onClick: () => void }) {
  const [chosen, setChosen] = useState<number>();
  return (
    <div className="flex flex-col">
      {answers.map((answer, index) => (
        <OptionRow
          key={answer}
          letter={optionLetter(index)}
          selected={chosen === index}
          onClick={() => {
            setChosen(index);
            onClick();
          }}
        >
          {answer}
        </OptionRow>
      ))}
    </div>
  );
}

export const List: Story = {
  render: (args) => <Question onClick={args.onClick} />,
};
