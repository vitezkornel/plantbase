import { isVoiceEvent, type VoiceEvent } from './voice-events';

export interface NdjsonParser {
  push(chunk: string): VoiceEvent[];
}

/** Incremental NDJSON → VoiceEvent parser; tolerates lines split across chunks. */
export function createNdjsonParser(): NdjsonParser {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      const events: VoiceEvent[] = [];
      for (const line of lines) {
        if (line.trim() === '') {
          continue;
        }
        try {
          const value: unknown = JSON.parse(line);
          if (isVoiceEvent(value)) {
            events.push(value);
          }
        } catch {
          // a malformed line is dropped; the stream goes on
        }
      }
      return events;
    },
  };
}
