// Cost guards for a billed realtime session: disconnect after five idle
// minutes, and at a hard cap even if the conversation never goes quiet.

export const IDLE_MS = 5 * 60_000;
export const MAX_SESSION_MS = 20 * 60_000;

export interface IdleTimer {
  /** Activity happened: restart the idle countdown. */
  touch(): void;
  stop(): void;
}

export interface IdleTimerOptions {
  idleMs?: number;
  maxMs?: number;
  onIdle: () => void;
  onMaxDuration: () => void;
}

export function createIdleTimer({
  idleMs = IDLE_MS,
  maxMs = MAX_SESSION_MS,
  onIdle,
  onMaxDuration,
}: IdleTimerOptions): IdleTimer {
  let stopped = false;
  let idleHandle: ReturnType<typeof setTimeout> | undefined;

  const stop = (): void => {
    stopped = true;
    clearTimeout(idleHandle);
    clearTimeout(maxHandle);
  };

  const startIdle = (): void => {
    clearTimeout(idleHandle);
    idleHandle = setTimeout(() => {
      stop();
      onIdle();
    }, idleMs);
  };

  const maxHandle = setTimeout(() => {
    stop();
    onMaxDuration();
  }, maxMs);
  startIdle();

  return {
    touch: () => {
      if (!stopped) {
        startIdle();
      }
    },
    stop,
  };
}
