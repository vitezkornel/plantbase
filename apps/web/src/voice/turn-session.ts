// The request in flight and the speech it feeds, as one thing to cancel:
// a barge-in (button pressed again) and leaving the page both end it.

export interface TurnSession {
  /** Starts a request: an earlier one still running is cancelled. */
  begin(): AbortController;
  /** Silences the speech and cancels the request in flight, if any. */
  interrupt(): void;
}

export function createTurnSession(speech: { stop(): void }): TurnSession {
  let current: AbortController | null = null;

  return {
    begin() {
      current?.abort();
      current = new AbortController();
      return current;
    },
    interrupt() {
      speech.stop();
      current?.abort();
      current = null;
    },
  };
}
