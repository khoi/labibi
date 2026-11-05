import { next } from "@vercel/functions";
import {
  AGENT_DISCOVERY_LINKS,
  getMarkdownAlternate,
  getMarkdownDocument,
  markdownResponse,
  negotiateRepresentation,
} from "./src/agent-content.js";

const VARY_HEADER = "Accept, Accept-Encoding";
const APEX_ORIGIN = "https://labradoodle.com";
const REDIRECT_HOSTS = new Set(["www.labradoodle.com", "labradoodle.com", "www.labradoodle.com"]);
const LEGACY_BLOG_PATH = "/blog/openclaw-vs-hermes-vs-labradoodle/";
const BLOG_PATH = "/blog/openclaw-vs-hermes-vs-labradoodle/";

export const config = {
  matcher: ["/((?!api|_astro|.*\\..*).*)", "/sitemap.xml"],
};

function permanentRedirect(location: string): Response {
  return new Response(null, {
    status: 301,
    headers: { Location: location },
  });
}

export default function middleware(request: Request): Response {
  const url = new URL(request.url);

  if (REDIRECT_HOSTS.has(url.hostname.toLowerCase()) || url.pathname === LEGACY_BLOG_PATH) {
    const pathname = url.pathname === LEGACY_BLOG_PATH ? BLOG_PATH : url.pathname;
    const destination = new URL(`${pathname}${url.search}`, APEX_ORIGIN);
    return permanentRedirect(destination.toString());
  }

  if (url.pathname === "/sitemap.xml") {
    const destination = new URL(`/sitemap-index.xml${url.search}`, APEX_ORIGIN);
    return permanentRedirect(destination.toString());
  }

  if (request.method !== "GET" && request.method !== "HEAD") return next();

  const acceptHeader = request.headers.get("accept");
  const representation = negotiateRepresentation(acceptHeader);
  const markdown = getMarkdownDocument(url.pathname);

  if (representation === "markdown" && markdown) {
    return markdownResponse(markdown, request.method);
  }

  if (representation === "not-acceptable") {
    return new Response(
      request.method === "HEAD"
        ? null
        : "Not acceptable. Request text/html or text/markdown.\n",
      {
        status: 406,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          Vary: VARY_HEADER,
        },
      },
    );
  }

  const markdownAlternate = getMarkdownAlternate(url.pathname);
  return next({
    headers: {
      Link: [
        AGENT_DISCOVERY_LINKS,
        ...(markdownAlternate
          ? [`<${markdownAlternate}>; rel="alternate"; type="text/markdown"`]
          : []),
      ].join(", "),
      Vary: VARY_HEADER,
    },
  });
}
