// Pre-generated filler sentences, held in memory for the life of the server
// process. The key is model + voice + text, so changing the voice or the
// model never plays an old recording. Reads never wait: a filler that is
// not ready is simply skipped.

import { ALL_FILLER_TEXTS } from './filler-texts';

interface Entry {
  value?: Uint8Array;
  settled?: Promise<void>;
}

interface FillerKey {
  model: string;
  voice: string;
  text: string;
}

// Next compiles every route into its own bundle, so a plain module-level
// Map would be one cache per route (the warm-up route would fill a cache that
// /api/voice never reads). The Map therefore lives on globalThis.
const CACHE_KEY = Symbol.for('plantbase.voice.fillerCache');
const globals = globalThis as { [CACHE_KEY]?: Map<string, Entry> };
const entries: Map<string, Entry> = (globals[CACHE_KEY] ??= new Map());

const keyOf = ({ model, voice, text }: FillerKey): string =>
  `${model}|${voice}|${text}`;

export interface WarmFillersInput {
  model: string;
  voice: string;
  synthesize: (text: string) => Promise<Uint8Array>;
  onFailure: (error: unknown) => void;
}

/** Starts generating every filler not yet cached; resolves when all settled. */
export async function warmFillers({
  model,
  voice,
  synthesize,
  onFailure,
}: WarmFillersInput): Promise<void> {
  const pending: Array<Promise<void>> = [];
  for (const text of ALL_FILLER_TEXTS) {
    const key = keyOf({ model, voice, text });
    const existing = entries.get(key);
    if (existing?.settled !== undefined) {
      pending.push(existing.settled);
      continue;
    }
    const entry: Entry = {};
    entry.settled = synthesize(text).then(
      (audio) => {
        entry.value = audio;
      },
      (error: unknown) => {
        entries.delete(key); // a later warm-up may retry
        onFailure(error);
      },
    );
    entries.set(key, entry);
    pending.push(entry.settled);
  }
  await Promise.all(pending);
}

export function getFillerIfReady(key: FillerKey): Uint8Array | undefined {
  return entries.get(keyOf(key))?.value;
}

export function clearFillerCache(): void {
  entries.clear();
}
