// The server → client contract of POST /api/voice: one JSON object per
// NDJSON line. Audio is base64-encoded mp3.

export type VoiceEvent =
  | { type: 'transcript'; text: string; sttMs: number }
  | { type: 'tool'; name: string }
  | { type: 'filler'; text: string; audio: string }
  | { type: 'text-delta'; text: string }
  | {
      type: 'sentence';
      index: number;
      text: string;
      audio: string;
      ttsMs: number;
    }
  | { type: 'escalated' }
  | {
      type: 'timing';
      sttMs: number;
      firstTokenMs: number | null;
      firstSentenceMs: number | null;
      totalMs: number;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

const EVENT_TYPES: ReadonlySet<string> = new Set([
  'transcript',
  'tool',
  'filler',
  'text-delta',
  'sentence',
  'escalated',
  'timing',
  'done',
  'error',
]);

export function isVoiceEvent(value: unknown): value is VoiceEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string' &&
    EVENT_TYPES.has(value.type)
  );
}
