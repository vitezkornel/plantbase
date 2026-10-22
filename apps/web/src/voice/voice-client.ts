import { createNdjsonParser } from './ndjson-parser';
import type { VoiceEvent } from './voice-events';
import type { HistoryMessage } from './voice-request-schema';

export interface StreamVoiceTurnInput {
  audio: Blob;
  history: HistoryMessage[];
  signal: AbortSignal;
  onEvent: (event: VoiceEvent) => void;
}

const FALLBACK_ERROR = 'Hiba történt. Kérlek, próbáld újra.';

/** Posts one recording and reports the NDJSON events as they arrive. */
export async function streamVoiceTurn({
  audio,
  history,
  signal,
  onEvent,
}: StreamVoiceTurnInput): Promise<void> {
  const form = new FormData();
  form.append('audio', audio, 'recording');
  form.append('history', JSON.stringify(history));

  const response = await fetch('/api/voice', {
    method: 'POST',
    body: form,
    signal,
  });
  if (!response.ok || response.body === null) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : FALLBACK_ERROR;
    throw new Error(message);
  }

  const parser = createNdjsonParser();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parser.push(decoder.decode(value, { stream: true })).forEach(onEvent);
  }
}
