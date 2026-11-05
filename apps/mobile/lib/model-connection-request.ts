import type { ModelRoleChoice } from "@labradoodle/contracts";
import type { Href } from "expo-router";

export type ModelConnectionRequest = {
  provider: string;
  /** The connection to manage, or null to add another one for the provider. */
  credentialId: string | null;
  /** Prefills an OpenAI-compatible endpoint, such as the Ollama Cloud preset. */
  baseUrl?: string;
  /** Only the main model's empty first slot takes the new connection's model on connect. */
  makeDefault: boolean;
  /**
   * Set when connecting fills a model slot; managing a connection leaves it unset.
   * May return the screen to continue in, such as the slot's picker for this connection.
   */
  onConnected?: (choice: ModelRoleChoice) => Promise<Href | undefined>;
};

/** Connecting checks the key and a test request with the provider, which a slow one can stretch past the default RPC timeout. */
export const MODEL_CONNECT_TIMEOUT_MS = 60_000;

let nextId = 0;
const requests = new Map<string, ModelConnectionRequest>();

/** Ephemeral, owner-scoped connect requests; never serialized into links or storage. */
export function openModelConnection(request: ModelConnectionRequest): string {
  const id = String(++nextId);
  requests.set(id, request);
  return id;
}

export function modelConnectionRequest(id: string): ModelConnectionRequest | undefined {
  return requests.get(id);
}

export function closeModelConnection(id: string): void {
  requests.delete(id);
}
