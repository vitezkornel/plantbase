// If the supervisor has not answered after five seconds, the model is asked
// ONCE for a short progress sentence. The instruction is a fixed constant and
// forbids any claim, like the filler (spec §5.4).

export const NUDGE_DELAY_MS = 5000;

export const PROGRESS_NUDGE_INSTRUCTIONS =
  'Mondd ennyit, egyetlen rövid mondatban: "Még keresem, mindjárt mondom." ' +
  'Ne állíts semmit termékről, árról, készletről vagy gondozásról.';

export interface ProgressNudge {
  /** Arms the nudge for one tool call (replaces a pending one). */
  start(): void;
  cancel(): void;
}

export function createProgressNudge({
  delayMs = NUDGE_DELAY_MS,
  onNudge,
}: {
  delayMs?: number;
  onNudge: () => void;
}): ProgressNudge {
  let handle: ReturnType<typeof setTimeout> | undefined;

  const cancel = (): void => {
    clearTimeout(handle);
    handle = undefined;
  };

  return {
    start: () => {
      cancel();
      handle = setTimeout(() => {
        handle = undefined;
        onNudge();
      }, delayMs);
    },
    cancel,
  };
}
