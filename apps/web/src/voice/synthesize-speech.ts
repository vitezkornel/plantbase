import { experimental_generateSpeech as generateSpeech } from 'ai';
import type { VoiceSpeechModel } from './voice-providers';

// gpt-4o-mini-tts sometimes accepts a request and then never answers (about
// every second call, measured from plain Node and curl as well), while a
// healthy call takes 1-3 s. So a silent request is given up on early and
// sent again, instead of waiting out one long timeout.
export const TTS_ATTEMPT_TIMEOUT_MS = 5_000;
export const TTS_MAX_ATTEMPTS = 3;

export interface SynthesizeSpeechInput {
  model: VoiceSpeechModel;
  voice: string;
  text: string;
  signal: AbortSignal;
  attemptTimeoutMs?: number;
}

/** One sentence → mp3 bytes. Retries only a request that stayed silent. */
export async function synthesizeSpeech({
  model,
  voice,
  text,
  signal,
  attemptTimeoutMs = TTS_ATTEMPT_TIMEOUT_MS,
}: SynthesizeSpeechInput): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt += 1) {
    const timeout = AbortSignal.timeout(attemptTimeoutMs);
    try {
      const { audio } = await generateSpeech({
        model,
        text,
        voice,
        outputFormat: 'mp3',
        abortSignal: AbortSignal.any([signal, timeout]),
        maxRetries: 0,
      });
      return audio.uint8Array;
    } catch (error: unknown) {
      const isSilent = timeout.aborted && !signal.aborted;
      if (!isSilent || attempt >= TTS_MAX_ATTEMPTS) {
        throw error;
      }
    }
  }
}
