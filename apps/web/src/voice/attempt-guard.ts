// Tells a slow async start (the microphone permission prompt) whether it is
// still the attempt the user wants: a release, or a newer press, makes every
// earlier attempt stale, so it must clean up instead of recording.

export interface AttemptGuard {
  /** Starts a new attempt; every earlier one becomes stale. */
  begin(): number;
  /** The user let go: the running attempt, if any, becomes stale. */
  invalidate(): void;
  isCurrent(attempt: number): boolean;
}

export function createAttemptGuard(): AttemptGuard {
  let latest = 0;
  return {
    begin() {
      latest += 1;
      return latest;
    },
    invalidate() {
      latest += 1;
    },
    isCurrent(attempt) {
      return attempt === latest;
    },
  };
}
