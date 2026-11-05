import { PAGE_RUNTIME_PATH } from "@labradoodle/core";
import { buildPageRuntime } from "@labradoodle/page-kit/runtime-build";
import type { Plugin } from "vite";
import { defineConfig } from "vite";
import { sourcePlugins } from "../vite.config.ts";

const pageRuntime: Plugin = {
  name: "storybook-page-runtime",
  configureServer(server) {
    server.middlewares.use(PAGE_RUNTIME_PATH, async (_request, response) => {
      response.setHeader("content-type", "text/javascript; charset=utf-8");
      response.end(await buildPageRuntime());
    });
  },
  async generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: PAGE_RUNTIME_PATH.slice(1),
      source: await buildPageRuntime(),
    });
  },
};

export default defineConfig({ plugins: [...sourcePlugins(), pageRuntime] });
