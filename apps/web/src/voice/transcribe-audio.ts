import { experimental_transcribe as transcribe } from 'ai';
import { PLANT_KEYWORDS } from './transcription-fetch';
import type { VoiceTranscriptionModel } from './voice-providers';
import { VoiceRequestError } from './voice-request-schema';

export const STT_TIMEOUT_MS = 15_000;
/** The client stops at 30 s; one second of slack for the container. */
export const MAX_AUDIO_SECONDS = 31;

export interface TranscribeAudioInput {
  model: VoiceTranscriptionModel;
  modelId: string;
  audio: Uint8Array;
  signal: AbortSignal;
}

export interface Transcript {
  /** Empty when the model heard nothing. */
  text: string;
  durationInSeconds: number | undefined;
}

export async function transcribeAudio({
  model,
  modelId,
  audio,
  signal,
}: TranscribeAudioInput): Promise<Transcript> {
  try {
    const result = await transcribe({
      model,
      audio,
      abortSignal: AbortSignal.any([
        signal,
        AbortSignal.timeout(STT_TIMEOUT_MS),
      ]),
      maxRetries: 0, // a voice turn is latency-bound: fail fast, the user can retry
      // gpt-transcribe gets its hints through the fetch wrapper
      // (transcription-fetch.ts); the other models take them as options.
      ...(modelId === 'gpt-transcribe'
        ? {}
        : {
            providerOptions: {
              openai: {
                language: 'hu',
                prompt: `Magyar nyelvű beszélgetés növényekről: ${PLANT_KEYWORDS.join(', ')}.`,
              },
            },
          }),
    });
    if (
      result.durationInSeconds !== undefined &&
      result.durationInSeconds > MAX_AUDIO_SECONDS
    ) {
      throw new VoiceRequestError('A felvétel túl hosszú.');
    }
    return { text: result.text, durationInSeconds: result.durationInSeconds };
  } catch (error: unknown) {
    // The SDK throws when the transcript is empty (silence). Its error class
    // is not exported by ai@5.0.261, so it is recognized by name.
    if (isNoTranscriptError(error)) {
      return { text: '', durationInSeconds: undefined };
    }
    throw error;
  }
}

function isNoTranscriptError(error: unknown): boolean {
  return (
    error instanceof Error && error.name === 'AI_NoTranscriptGeneratedError'
  );
}
