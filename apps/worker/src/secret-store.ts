import type { RealtimeFanout, SecretStore } from "@labradoodle/adapter-kit";
import { createSecretStore } from "@labradoodle/adapters";
import { resolveEncryptionKey } from "@labradoodle/core";

/** Worker composition without starting job hosts or database connections. */
export async function createWorkerSecretStore(
  source: NodeJS.ProcessEnv,
  realtime?: RealtimeFanout,
): Promise<SecretStore> {
  const store = createSecretStore(resolveEncryptionKey(source), source, realtime);
  await store.start();
  return store;
}
