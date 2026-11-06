import type { AppBootstrap } from "@labradoodle/contracts";
import { ATTACHMENT_MAX_BYTES, attachmentMaxBytes } from "@labradoodle/contracts";
import { displayIdentityResult } from "@labradoodle/core";
import { initialBootstrapTarget } from "./bootstrap-target";
import { identityLabels } from "./identity-display";
import { markOnce } from "./performance";
import { rpc, selectedSpaceId } from "./rpc";

let maxUploadSizeBytes = ATTACHMENT_MAX_BYTES;
export function getMaxUploadSizeBytes() {
  return maxUploadSizeBytes;
}

let primedBootstrap: {
  threadId?: string;
  spaceId?: string;
  promise: Promise<AppBootstrap>;
  /** What this space showed last time, painted while the fresh bootstrap loads. */
  seed?: AppBootstrap;
} | null = null;

const initialTarget = initialBootstrapTarget(
  window.location.pathname,
  Boolean(window.labradoodleDesktop),
);
if (initialTarget) {
  const { threadId } = initialTarget;
  const promise = requestBootstrap(threadId);
  // Authentication can redirect before Shell consumes this speculative request.
  // Register a rejection handler immediately while preserving rejection for a consumer.
  void promise.catch(() => undefined);
  primedBootstrap = { threadId, promise };
}

/** The speculative first-load bootstrap, left in place for the shell to take. */
export function peekInitialBootstrap(): Promise<AppBootstrap> | undefined {
  // Only the speculative first load may be shared with the subscription gate.
  return primedBootstrap?.spaceId === undefined ? primedBootstrap?.promise : undefined;
}

function primedFor(threadId: string | undefined) {
  const primed = primedBootstrap;
  return primed &&
    primed.threadId === threadId &&
    (primed.spaceId === undefined || primed.spaceId === selectedSpaceId())
    ? primed
    : null;
}

/** The cached bootstrap a revisited space opens with, if the switch had one. */
export function peekBootstrapSeed(threadId?: string): AppBootstrap | undefined {
  return primedFor(threadId)?.seed;
}

export function takeInitialBootstrap(threadId?: string) {
  const primed = primedFor(threadId);
  primedBootstrap = null;
  if (primed) {
    if (primed.seed) applyCapabilities(primed.seed);
    return (
      primed.spaceId === undefined ? primed.promise : primed.promise.then(applyCapabilities)
    ).then(
      (value) => displayIdentityResult(["bootstrap"], value, identityLabels()) as AppBootstrap,
    );
  }
  return requestBootstrap(threadId);
}

/**
 * Loads another space's bootstrap without selecting that space, and leaves it
 * for the shell to take once the space is selected. Rejects on failure so the
 * caller can fall back to a full reload. A `seed` from an earlier visit lets the
 * shell paint at once while this request refreshes it.
 */
export function primeSpaceBootstrap(
  spaceId: string,
  threadId?: string,
  seed?: AppBootstrap,
): Promise<AppBootstrap> {
  const promise = requestBootstrap(threadId, spaceId);
  void promise.catch(() => undefined);
  primedBootstrap = { threadId, spaceId, promise, seed };
  return promise;
}

/** Drops a primed bootstrap nobody will take, so a later shell cannot take another space's. */
export function discardPrimedBootstrap(promise: Promise<AppBootstrap>): void {
  if (primedBootstrap?.promise === promise) primedBootstrap = null;
}

function requestBootstrap(threadId?: string, spaceId?: string) {
  markOnce("rk:renderer:bootstrap-request-start");
  const input = threadId ? { threadId } : {};
  const request = spaceId ? rpc.bootstrap(input, { context: { spaceId } }) : rpc.bootstrap(input);
  return request.then((bootstrap) => {
    markOnce("rk:renderer:bootstrap-response");
    return spaceId === undefined ? applyCapabilities(bootstrap) : bootstrap;
  });
}

function applyCapabilities(bootstrap: AppBootstrap): AppBootstrap {
  maxUploadSizeBytes = attachmentMaxBytes(bootstrap.me);
  return bootstrap;
}
