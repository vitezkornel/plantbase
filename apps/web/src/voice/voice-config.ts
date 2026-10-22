export const DEFAULT_STT_MODEL = 'gpt-transcribe';
// The snapshot with the best Hungarian pronunciation and no silent requests
// (docs/voice-meresek.md). It is marked for retirement, so voice-providers
// adds tts-1 as an automatic fallback (tts-fallback.ts).
export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts-2025-03-20';
export const DEFAULT_TTS_VOICE = 'coral';

export const NOT_CONFIGURED_MESSAGE =
  'A hangfunkció nincs beállítva (hiányzik az OPENAI_API_KEY).';

export interface VoiceConfig {
  apiKey: string | undefined;
  sttModel: string;
  ttsModel: string;
  voice: string;
}

export class VoiceNotConfiguredError extends Error {
  constructor() {
    super(NOT_CONFIGURED_MESSAGE);
    this.name = 'VoiceNotConfiguredError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

export function readVoiceConfig(env: Env = process.env): VoiceConfig {
  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };
  return {
    apiKey: read('OPENAI_API_KEY'),
    sttModel: read('VOICE_STT_MODEL') ?? DEFAULT_STT_MODEL,
    ttsModel: read('VOICE_TTS_MODEL') ?? DEFAULT_TTS_MODEL,
    voice: read('VOICE_TTS_VOICE') ?? DEFAULT_TTS_VOICE,
  };
}
