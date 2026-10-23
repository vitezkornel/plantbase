// Two silences, both ending at the first sound of the agent's voice:
//  (a) the user stopped speaking → first agent audio (what the user feels);
//  (b) the tool call started → first agent audio (what the filler fixes).
// The first agent audio after arming ends both; later audio is ignored until
// the next arming.

export interface SilenceMeasurement {
  sinceSpeechStopMs: number | null;
  sinceToolMs: number | null;
}

export interface SilenceMeter {
  speechStarted(): void;
  speechStopped(now: number): void;
  toolCalled(now: number): void;
  agentAudio(now: number): SilenceMeasurement;
  running(now: number): SilenceMeasurement;
  reset(): void;
}

export function createSilenceMeter(): SilenceMeter {
  let stoppedAt: number | null = null;
  let toolAt: number | null = null;

  const since = (start: number | null, now: number): number | null =>
    start === null ? null : now - start;

  return {
    speechStarted: () => {
      stoppedAt = null;
      toolAt = null;
    },
    speechStopped: (now) => {
      stoppedAt = now;
    },
    toolCalled: (now) => {
      toolAt = now;
    },
    agentAudio: (now) => {
      const result = {
        sinceSpeechStopMs: since(stoppedAt, now),
        sinceToolMs: since(toolAt, now),
      };
      stoppedAt = null;
      toolAt = null;
      return result;
    },
    running: (now) => ({
      sinceSpeechStopMs: since(stoppedAt, now),
      sinceToolMs: since(toolAt, now),
    }),
    reset: () => {
      stoppedAt = null;
      toolAt = null;
    },
  };
}
