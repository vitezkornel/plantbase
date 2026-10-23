import {
  DEFAULT_STT_MODEL,
  VoiceNotConfiguredError,
} from '../voice/voice-config';

export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1';
// The model the instructor's demo ran on; used if the default is unavailable.
export const DEFAULT_REALTIME_FALLBACK_MODEL = 'gpt-realtime';
export const DEFAULT_REASONING_EFFORT = 'low';
export const DEFAULT_REALTIME_VOICE = 'marin';

export interface RealtimeConfig {
  apiKey: string | undefined;
  model: string;
  fallbackModel: string;
  reasoningEffort: string;
  voice: string;
  sttModel: string;
  demoOrders: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

export function readRealtimeConfig(env: Env = process.env): RealtimeConfig {
  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };
  return {
    apiKey: read('OPENAI_API_KEY'),
    model: read('VOICE_REALTIME_MODEL') ?? DEFAULT_REALTIME_MODEL,
    fallbackModel:
      read('VOICE_REALTIME_FALLBACK_MODEL') ?? DEFAULT_REALTIME_FALLBACK_MODEL,
    reasoningEffort:
      read('VOICE_REALTIME_REASONING_EFFORT') ?? DEFAULT_REASONING_EFFORT,
    voice: read('VOICE_REALTIME_VOICE') ?? DEFAULT_REALTIME_VOICE,
    sttModel: read('VOICE_STT_MODEL') ?? DEFAULT_STT_MODEL,
    demoOrders: read('VOICE_DEMO_ORDERS') === '1',
  };
}

export function requireApiKey(config: RealtimeConfig): string {
  if (config.apiKey === undefined) {
    throw new VoiceNotConfiguredError();
  }
  return config.apiKey;
}
