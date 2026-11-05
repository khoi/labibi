import "../src/storybook/api";
import "../src/zod-config";
import "../src/styles.css";
import { Toaster, TooltipProvider } from "@labradoodle/ui-web";
import { I18nProvider } from "@lingui/react";
import type { Preview } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useLayoutEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { applyUiDirection } from "../src/lib/apply-ui-direction";
import { bootstrapI18n, i18n } from "../src/lib/i18n";
import { QueryUserProvider, queryClient } from "../src/lib/query";
import type { ResolvedAppearance } from "../src/lib/ui-appearance";
import { applyResolvedAppearance } from "../src/lib/ui-appearance";
import type { UiLocale } from "../src/lib/ui-locale";
import { UI_LOCALE_LABELS, UI_LOCALES } from "../src/lib/ui-locale";
import { serveFixtures } from "../src/storybook/api";
import { DEFAULT_API, DEFAULT_HTTP, USER_ID } from "../src/storybook/fixtures";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    route: "/",
    api: DEFAULT_API,
    http: DEFAULT_HTTP,
  },
  globalTypes: {
    theme: {
      description: "Theme",
      toolbar: { icon: "contrast", items: ["light", "dark"], dynamicTitle: true },
    },
    locale: {
      description: "Language",
      toolbar: {
        icon: "globe",
        items: UI_LOCALES.map((value) => ({ value, title: UI_LOCALE_LABELS[value] })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light", locale: "en" },
  loaders: [({ globals }) => bootstrapI18n(globals.locale as UiLocale)],
  beforeEach: ({ parameters }) => {
    serveFixtures(parameters);
    queryClient.clear();
  },
  decorators: [
    (Story, { globals, parameters }) => {
      const theme = globals.theme as ResolvedAppearance;
      const locale = globals.locale as UiLocale;
      useLayoutEffect(() => applyResolvedAppearance(theme), [theme]);
      useEffect(() => {
        void bootstrapI18n(locale).then(applyUiDirection);
      }, [locale]);
      return (
        <I18nProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <QueryUserProvider value={USER_ID}>
              <TooltipProvider>
                <MemoryRouter initialEntries={[parameters.route]}>
                  <Story />
                </MemoryRouter>
                <Toaster />
              </TooltipProvider>
            </QueryUserProvider>
          </QueryClientProvider>
        </I18nProvider>
      );
    },
  ],
};

export default preview;
