// The browser → /api/voice boundary: untrusted input (konvenciok.md
// "Biztonság"), validated fail-fast. Strict: an unknown field is an error.

import { z } from 'zod';

export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const ALLOWED_AUDIO_TYPES: readonly string[] = [
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/m4a',
];

const ALLOWED_FIELDS: ReadonlySet<string> = new Set(['audio', 'history']);

const HistorySchema = z
  .array(
    z.strictObject({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(2000),
    }),
  )
  .max(20);

export type HistoryMessage = z.infer<typeof HistorySchema>[number];

export interface VoiceRequest {
  audio: Uint8Array;
  /** The MIME type without parameters, e.g. `audio/webm`. */
  mediaType: string;
  history: HistoryMessage[];
}

/** A client mistake (→ HTTP 400); its message is safe to log, never the input. */
export class VoiceRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceRequestError';
  }
}

export async function parseVoiceRequest(form: FormData): Promise<VoiceRequest> {
  for (const key of form.keys()) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new VoiceRequestError('Unknown form field.');
    }
  }

  const audio = form.get('audio');
  if (!(audio instanceof Blob)) {
    throw new VoiceRequestError('The audio field is missing.');
  }
  if (audio.size === 0 || audio.size > MAX_AUDIO_BYTES) {
    throw new VoiceRequestError('The audio size is out of range.');
  }
  const mediaType = (audio.type.split(';')[0] ?? '').trim().toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.includes(mediaType)) {
    throw new VoiceRequestError('Unsupported audio type.');
  }

  return {
    audio: new Uint8Array(await audio.arrayBuffer()),
    mediaType,
    history: parseHistory(form.get('history')),
  };
}

function parseHistory(raw: FormDataEntryValue | null): HistoryMessage[] {
  if (raw === null) {
    return [];
  }
  if (typeof raw !== 'string') {
    throw new VoiceRequestError('The history must be text.');
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new VoiceRequestError('The history is not valid JSON.');
  }
  const parsed = HistorySchema.safeParse(json);
  if (!parsed.success) {
    throw new VoiceRequestError('The history is invalid.');
  }
  return parsed.data;
}
