import type { Meta, StoryObj } from "@storybook/react-vite";
import { PdfViewer } from "./PdfViewer";

function samplePdf(pages: string[][]): Uint8Array {
  const pageIds = pages.map((_, index) => 4 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
  ];
  for (const [index, lines] of pages.entries()) {
    const text = lines
      .map((line, row) => `BT /F1 ${row ? 14 : 22} Tf 72 ${720 - row * 30} Td (${line}) Tj ET`)
      .join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageIds[index]! + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const INVOICE = samplePdf([
  ["Invoice 2026-10", "Example Studio", "Design work, October", "Total: $1,200.00"],
]);

const HANDBOOK = samplePdf([
  ["Team handbook", "1. Welcome"],
  ["2. How we work", "Plans are written down."],
  ["3. Time off", "Ask a week ahead."],
]);

const meta = {
  title: "Viewers/PDF viewer",
  component: PdfViewer,
  parameters: { layout: "padded" },
  args: { bytes: INVOICE, title: "Invoice 2026-10" },
  argTypes: { bytes: { control: false } },
  decorators: [
    (Story) => (
      <div className="h-[560px] overflow-hidden rounded-xl border border-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PdfViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnePage: Story = {};

export const SeveralPages: Story = { args: { bytes: HANDBOOK, title: "Team handbook" } };
