import { createOpenAI } from '@ai-sdk/openai';
import type {
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
  LanguageModel,
} from 'ai';
import { FALLBACK_TTS_MODEL } from './tts-fallback';
import { createTranscriptionFetch } from './transcription-fetch';
import { VoiceNotConfiguredError, type VoiceConfig } from './voice-config';

export type VoiceTranscriptionModel = Parameters<typeof transcribe>[0]['model'];
export type VoiceSpeechModel = Parameters<typeof generateSpeech>[0]['model'];

export interface VoiceDeps {
  config: VoiceConfig;
  transcriptionModel: VoiceTranscriptionModel;
  speechModel: VoiceSpeechModel;
  /** Used for a sentence when the speech model is retired (tts-fallback.ts). */
  fallbackSpeechModel?: VoiceSpeechModel;
  /** Test seam: replaces the real ask-agent model. */
  askModel?: LanguageModel;
}

/** The one place that names the provider; change it here to swap it. */
export function createVoiceDeps(config: VoiceConfig): VoiceDeps {
  if (config.apiKey === undefined) {
    throw new VoiceNotConfiguredError();
  }
  const openai = createOpenAI({
    apiKey: config.apiKey,
    fetch: createTranscriptionFetch(),
  });
  return {
    config,
    transcriptionModel: openai.transcription(config.sttModel),
    speechModel: openai.speech(config.ttsModel),
    ...(config.ttsModel === FALLBACK_TTS_MODEL
      ? {}
      : { fallbackSpeechModel: openai.speech(FALLBACK_TTS_MODEL) }),
  };
}
