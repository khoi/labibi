import type { ComputerRef } from "@labradoodle/adapter-kit";
import { ComputerInUseError } from "./computer-lifecycle.js";

/**
 * A run's computer, started the first time a tool needs it.
 *
 * Remote computers bill while they run, so a run that never touches its computer must not
 * create or resume one. A failed start is kept: every later use rethrows it as a setup failure.
 * A computer busy with other work is not a failure: that use gets the error, and a later one
 * tries again.
 */
export function lazyRunComputer(start: () => Promise<ComputerRef>, onFailure?: () => void) {
  let started: Promise<ComputerRef> | undefined;
  let ready: ComputerRef | undefined;
  let failed = false;
  let failure: unknown;
  return {
    get(): Promise<ComputerRef> {
      started ??= start().then(
        (computer) => {
          ready = computer;
          return computer;
        },
        (error: unknown) => {
          if (error instanceof ComputerInUseError) {
            started = undefined;
            throw error;
          }
          failed = true;
          failure = error;
          onFailure?.();
          throw error;
        },
      );
      return started;
    },
    /** The computer if a tool already started it. */
    get ready(): ComputerRef | undefined {
      return ready;
    },
    throwIfFailed(): void {
      if (failed) throw failure;
    },
  };
}
