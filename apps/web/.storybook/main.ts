import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  framework: {
    name: "@storybook/react-vite",
    options: { builder: { viteConfigPath: ".storybook/vite.config.ts" } },
  },
  stories: ["../src/**/*.stories.tsx", "../../../packages/ui-web/src/**/*.stories.tsx"],
  core: { disableTelemetry: true },
  typescript: { reactDocgen: false },
};

export default config;
