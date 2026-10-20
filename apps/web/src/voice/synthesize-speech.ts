import { experimental_generateSpeech as generateSpeech } from 'ai';
import type { VoiceSpeechModel } from './voice-providers';

export const TTS_TIMEOUT_MS = 15_000;

export interface SynthesizeSpeechInput {
  model: VoiceSpeechModel;
  voice: string;
  text: string;
  signal: AbortSignal;
}

/** One sentence → mp3 bytes. */
export async function synthesizeSpeech({
  model,
  voice,
  text,
  signal,
}: SynthesizeSpeechInput): Promise<Uint8Array> {
  const { audio } = await generateSpeech({
    model,
    text,
    voice,
    outputFormat: 'mp3',
    abortSignal: AbortSignal.any([signal, AbortSignal.timeout(TTS_TIMEOUT_MS)]),
    maxRetries: 0,
  });
  return audio.uint8Array;
}
