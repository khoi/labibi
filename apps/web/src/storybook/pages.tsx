import { pageViewerCode } from "@labradoodle/page-kit/compile";
import type { ReactNode } from "react";
import { usePageDocument } from "../lib/pages";

export const PAGE_CODE = pageViewerCode(`
export default function LaunchTracker() {
  return (
    <Page title="Q3 launch tracker" summary="Where the launch stands, updated every morning.">
      <Metrics metrics={[
        { value: "18 / 24", label: "Tasks done" },
        { value: "1,240", label: "Signups", detail: "+12% this week", tone: "success" },
        { value: "9", label: "Days left" },
      ]} />
      <Section heading="Open tasks">
        <Checklist items={[
          { text: "Launch post", done: false, meta: "Scout, Tuesday" },
          { text: "Pricing page", done: true, meta: "Ada Park, Wednesday" },
          { text: "Invoice export", done: false, meta: "Ledger, Friday" },
          { text: "Press kit", done: false, meta: "Chief, next Monday" },
        ]} />
      </Section>
    </Page>
  );
}
`);

export function WithPageDocument({
  children,
}: {
  children: (document: string | null) => ReactNode;
}) {
  return children(usePageDocument(PAGE_CODE).document);
}
