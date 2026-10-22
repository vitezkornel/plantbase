export type PttPhase = 'idle' | 'recording';
export type PttEvent = 'press' | 'release' | 'timeout' | 'cancel';
export type PttAction = 'start' | 'stop' | 'discard' | null;

/** The press-and-hold state machine; keeps double triggers from double recording. */
export function nextPttPhase(
  phase: PttPhase,
  event: PttEvent,
): { phase: PttPhase; action: PttAction } {
  if (phase === 'idle') {
    return event === 'press'
      ? { phase: 'recording', action: 'start' }
      : { phase: 'idle', action: null };
  }
  switch (event) {
    case 'press':
      return { phase: 'recording', action: null };
    case 'cancel':
      return { phase: 'idle', action: 'discard' };
    default:
      return { phase: 'idle', action: 'stop' };
  }
}
