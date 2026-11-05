import type { Meta, StoryObj } from "@storybook/react-vite";
import { useLayoutEffect, useRef, useState } from "react";
import { fn } from "storybook/test";
import { QuoteSelectionButton } from "./quote-selection-button";

const TEXT =
  "Sure. I'll pull revenue and churn from the finance sheet, draft a one paragraph summary, and send it to you for review on Monday.";

function SelectedReply({
  onQuote,
  quote,
  atTop,
}: {
  onQuote: () => void;
  quote: string;
  atTop: boolean;
}) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const [range, setRange] = useState<Range | null>(null);
  useLayoutEffect(() => {
    const node = textRef.current?.firstChild;
    if (!node) return;
    const start = Math.max(0, TEXT.indexOf(quote));
    const next = document.createRange();
    next.setStart(node, start);
    next.setEnd(node, Math.min(TEXT.length, start + quote.length));
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(next);
    setRange(next);
  }, [quote]);
  return (
    <div className={atTop ? "px-6" : "px-6 pt-24"}>
      <p
        ref={textRef}
        className="w-fit max-w-md rounded-[20px] bg-muted px-[18px] py-3 text-body1 text-foreground"
      >
        {TEXT}
      </p>
      {range ? <QuoteSelectionButton range={range} onQuote={onQuote} /> : null}
    </div>
  );
}

const meta = {
  title: "Chat/Quote selection button",
  component: SelectedReply,
  args: { onQuote: fn(), quote: "draft a one paragraph summary", atTop: false },
} satisfies Meta<typeof SelectedReply>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AboveSelection: Story = {};

export const BelowSelection: Story = { args: { quote: "pull revenue and churn", atTop: true } };
