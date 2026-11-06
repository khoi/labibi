import {
  abortableDelay,
  DOOD_INK,
  DOODLE_DOOD,
  DOODLE_NAME,
  isRetryableError,
} from "@labradoodle/core";
import { useCallback, useEffect, useState } from "react";
import type { MobileDoodle } from "./api";
import { rpc, subscribeNotifications } from "./api";
import { errorText } from "./user-error";

/** Doodle as the voice dock and mention chips show it. */
export const DOODLE_SPEAKER = { name: DOODLE_NAME, color: DOOD_INK[DOODLE_DOOD.color].ink };

/**
 * The workspace's Doodle. `live` also follows changes made elsewhere (the owner on another
 * device), which the server announces on the notification stream.
 */
export function useDoodle(live = false) {
  const [doodle, setDoodle] = useState<MobileDoodle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(
    () =>
      rpc("doodle/get")
        .then((next) => {
          setDoodle(next);
          setError(null);
          return next;
        })
        .catch((err: unknown) => {
          setError(errorText(err));
          return null;
        }),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!live) return;
    const abort = new AbortController();
    void (async () => {
      let retryMs = 1_000;
      while (!abort.signal.aborted) {
        try {
          await subscribeNotifications((event) => {
            retryMs = 1_000;
            if (event.type === "doodle") void reload();
          }, abort.signal);
        } catch (err) {
          if (!isRetryableError(err)) return;
        }
        await abortableDelay(retryMs, abort.signal).catch(() => undefined);
        retryMs = Math.min(retryMs * 2, 30_000);
      }
    })();
    return () => abort.abort();
  }, [live, reload]);
  return { doodle, setDoodle, error, reload };
}
