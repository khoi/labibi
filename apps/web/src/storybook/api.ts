import type { Client } from "@orpc/client";
import { ORPCError, os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { action } from "storybook/actions";
import type { RpcClient } from "../lib/rpc";

type Fixture<I, O> =
  | O
  | ((input: I) => O extends AsyncIterable<infer Event> ? AsyncIterable<Event> : O | Promise<O>);

export type ApiFixtures<T = RpcClient> = {
  [K in keyof T]?: T[K] extends Client<infer _Context, infer I, infer O, infer _Error>
    ? Fixture<I, O>
    : ApiFixtures<T[K]>;
};

export type HttpFixtures = Record<string, unknown>;

export function api(fixtures: ApiFixtures): ApiFixtures {
  return fixtures;
}

let fixtures: ApiFixtures = {};
let http: HttpFixtures = {};

export function serveFixtures(next: { api?: ApiFixtures; http?: HttpFixtures }) {
  fixtures = next.api ?? {};
  http = next.http ?? {};
}

function lookup(path: string[]): { value: unknown } | undefined {
  let node: unknown = fixtures;
  for (const key of path) {
    if (node === null || typeof node !== "object" || !Object.hasOwn(node, key)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return { value: node };
}

async function answerRpc(request: Request, path: string[]): Promise<Response> {
  const name = path.join(".");
  const found = lookup(path);
  const procedure = os.handler(async ({ input }) => {
    action(`rpc ${name}`)(input);
    if (!found) {
      console.warn(`[storybook] no fixture for rpc ${name}`);
      throw new ORPCError("NOT_IMPLEMENTED", { message: `No story fixture for ${name}` });
    }
    return typeof found.value === "function" ? found.value(input) : found.value;
  });
  const router = path.reduceRight<object>((child, key) => ({ [key]: child }), procedure);
  const { response } = await new RPCHandler(router as never).handle(request, { prefix: "/rpc" });
  return response ?? new Response(null, { status: 404 });
}

const realFetch = window.fetch.bind(window);

window.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== window.location.origin) return realFetch(request);
  if (url.pathname.startsWith("/rpc/")) {
    return answerRpc(request, url.pathname.slice("/rpc/".length).split("/"));
  }
  if (Object.hasOwn(http, url.pathname)) {
    action(`http ${url.pathname}`)(request.method);
    return Response.json(http[url.pathname]);
  }
  return realFetch(request);
};
