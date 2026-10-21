// The preferred TTS model is a dated snapshot, and snapshots get retired.
// When the API says the model is gone, the sentence is generated again with
// a stable model, and the process remembers it, so a dead model is not
// retried for every following sentence.

import { logger } from 'core';
import { synthesizeSpeech } from './synthesize-speech';
import type { VoiceSpeechModel } from './voice-providers';

export const FALLBACK_TTS_MODEL = 'tts-1';

const UNAVAILABLE_STATUS: ReadonlySet<number> = new Set([404, 410]);
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'model_not_found',
  'model_deprecated',
  'deprecated_model',
]);

// On globalThis: each Next route has its own bundle, and the warm-up route
// and /api/voice must agree on which model is dead.
const DEAD_KEY = Symbol.for('plantbase.voice.unavailableTtsModels');
const globals = globalThis as { [DEAD_KEY]?: Set<string> };
const unavailable: Set<string> = (globals[DEAD_KEY] ??= new Set());

export function resetUnavailableModels(): void {
  unavailable.clear();
}

/** A 4xx that says "this model cannot be used" (not auth, not rate limit). */
export function isModelUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if (
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    UNAVAILABLE_STATUS.has(error.statusCode)
  ) {
    return true;
  }
  const code =
    'data' in error &&
    typeof error.data === 'object' &&
    error.data !== null &&
    'error' in error.data &&
    typeof error.data.error === 'object' &&
    error.data.error !== null &&
    'code' in error.data.error
      ? error.data.error.code
      : undefined;
  return typeof code === 'string' && UNAVAILABLE_CODES.has(code);
}

export interface FallbackSpeechDeps {
  config: { ttsModel: string; voice: string };
  speechModel: VoiceSpeechModel;
  fallbackSpeechModel?: VoiceSpeechModel;
}

export interface SynthesizeWithFallbackInput {
  deps: FallbackSpeechDeps;
  text: string;
  signal: AbortSignal;
}

export async function synthesizeWithFallback({
  deps,
  text,
  signal,
}: SynthesizeWithFallbackInput): Promise<Uint8Array> {
  const { config, speechModel, fallbackSpeechModel } = deps;
  const speak = (model: VoiceSpeechModel): Promise<Uint8Array> =>
    synthesizeSpeech({ model, voice: config.voice, text, signal });

  if (fallbackSpeechModel === undefined) {
    return speak(speechModel);
  }
  if (unavailable.has(config.ttsModel)) {
    return speak(fallbackSpeechModel);
  }
  try {
    return await speak(speechModel);
  } catch (error: unknown) {
    if (!isModelUnavailable(error)) {
      throw error;
    }
    if (!unavailable.has(config.ttsModel)) {
      unavailable.add(config.ttsModel);
      logger.warn('api_voice.tts_fallback', {
        from: config.ttsModel,
        to: FALLBACK_TTS_MODEL,
      });
    }
    return speak(fallbackSpeechModel);
  }
}
