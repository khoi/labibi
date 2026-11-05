import type { Artifact } from "@labradoodle/contracts";
import { ORPCError } from "@orpc/server";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { api } from "../storybook/api";
import { CHIEF, LEDGER, SCOUT } from "../storybook/fixtures";
import { ArtifactsPage } from "./Artifacts";

const VIEW_MODE_KEY = "rakazo:artifacts-view-mode";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function artifact(
  overrides: Partial<Artifact> & Pick<Artifact, "id" | "name" | "mimeType">,
  versionCount = 1,
): Artifact & { versionCount: number } {
  return {
    botId: CHIEF.id,
    groupId: null,
    runId: null,
    description: null,
    size: 2_048,
    version: versionCount,
    createdAt: daysAgo(1),
    ...overrides,
    versionCount,
  };
}

const ITEMS = [
  artifact(
    {
      id: "artifact-1",
      name: "Q3 report summary",
      description: "One-paragraph summary of revenue and churn for the quarter.",
      mimeType: "text/markdown",
      createdAt: daysAgo(0),
    },
    3,
  ),
  artifact({
    id: "artifact-2",
    name: "Churn sources",
    description: "Three recent sources on customer churn, with notes.",
    mimeType: "text/plain",
    botId: SCOUT.id,
  }),
  artifact({
    id: "artifact-3",
    name: "October invoices",
    mimeType: "application/pdf",
    botId: LEDGER.id,
    size: 184_320,
    createdAt: daysAgo(3),
  }),
  artifact({
    id: "artifact-4",
    name: "Launch landing page",
    description: "Draft page for the launch post.",
    mimeType: "text/html",
    createdAt: daysAgo(9),
  }),
  artifact({
    id: "artifact-5",
    name: "Team photo",
    mimeType: "image/png",
    botId: SCOUT.id,
    createdAt: daysAgo(40),
  }),
  artifact({
    id: "artifact-6",
    name: "Spend by vendor",
    mimeType: "text/csv",
    botId: LEDGER.id,
    createdAt: daysAgo(41),
  }),
];

const SUMMARY = `# Q3 report summary

Revenue grew **12%** over the quarter while churn held at 3.1%. The biggest shift was in why
customers left: missing features now outrank price.

## Next steps

1. Share the summary with the team on Monday
2. Follow up on the top three feature requests
3. Revisit pricing in the Q4 plan
`;

const failing = (message: string) => () => {
  throw new ORPCError("FORBIDDEN", { message });
};

const meta = {
  title: "Views/Artifacts",
  component: ArtifactsPage,
  parameters: {
    route: "/app/artifacts",
    api: api({
      artifacts: {
        listSpace: { items: ITEMS, nextCursor: null },
        listVersions: [3, 2, 1].map((version) => ({
          id: version === 3 ? "artifact-1" : `artifact-1-v${version}`,
          version,
          name: "Q3 report summary",
          createdAt: daysAgo(3 - version),
        })),
        getById: ({ artifactId }) => ({
          ...ITEMS[0]!,
          id: artifactId,
          contentBase64: btoa(SUMMARY),
        }),
      },
    }),
  },
  beforeEach: () => {
    window.localStorage.removeItem(VIEW_MODE_KEY);
  },
  render: () => (
    <Routes>
      <Route path="/app/artifacts" element={<ArtifactsPage />} />
      <Route path="/app/artifacts/:artifactId" element={<ArtifactsPage />} />
    </Routes>
  ),
} satisfies Meta<typeof ArtifactsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grid: Story = {};

export const ListView: Story = {
  beforeEach: () => {
    window.localStorage.setItem(VIEW_MODE_KEY, "list");
  },
};

export const Detail: Story = { parameters: { route: "/app/artifacts/artifact-1" } };

export const Empty: Story = {
  parameters: { api: api({ artifacts: { listSpace: { items: [], nextCursor: null } } }) },
};

export const Loading: Story = {
  parameters: { api: api({ artifacts: { listSpace: () => new Promise(() => {}) } }) },
};

export const LoadError: Story = {
  parameters: {
    api: api({ artifacts: { listSpace: failing("Could not load artifacts.") } }),
  },
};

export const DetailError: Story = {
  parameters: {
    route: "/app/artifacts/artifact-1",
    api: api({ artifacts: { getById: failing("Could not load this artifact.") } }),
  },
};
