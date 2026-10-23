import { describe, expect, it } from 'vitest';
import { VoiceNotConfiguredError } from '../voice/voice-config';
import { readRealtimeConfig, requireApiKey } from './realtime-config';

describe('readRealtimeConfig', () => {
  it('should use the documented defaults', () => {
    expect(readRealtimeConfig({})).toEqual({
      apiKey: undefined,
      model: 'gpt-realtime-2.1',
      fallbackModel: 'gpt-realtime',
      reasoningEffort: 'low',
      voice: 'marin',
      sttModel: 'gpt-transcribe',
      demoOrders: false,
    });
  });

  it('should read overrides and trim them', () => {
    const config = readRealtimeConfig({
      OPENAI_API_KEY: ' sk-x ',
      VOICE_REALTIME_MODEL: 'gpt-realtime-2.1-mini',
      VOICE_REALTIME_FALLBACK_MODEL: 'gpt-realtime-mini',
      VOICE_REALTIME_REASONING_EFFORT: 'minimal',
      VOICE_REALTIME_VOICE: 'cedar',
      VOICE_STT_MODEL: 'gpt-4o-mini-transcribe',
    });

    expect(config).toMatchObject({
      apiKey: 'sk-x',
      model: 'gpt-realtime-2.1-mini',
      fallbackModel: 'gpt-realtime-mini',
      reasoningEffort: 'minimal',
      voice: 'cedar',
      sttModel: 'gpt-4o-mini-transcribe',
    });
  });

  it('should enable the demo orders only for exactly "1"', () => {
    expect(readRealtimeConfig({ VOICE_DEMO_ORDERS: '1' }).demoOrders).toBe(true);
    expect(readRealtimeConfig({ VOICE_DEMO_ORDERS: 'true' }).demoOrders).toBe(
      false,
    );
    expect(readRealtimeConfig({ VOICE_DEMO_ORDERS: '' }).demoOrders).toBe(false);
  });

  it('should throw VoiceNotConfiguredError when the key is missing', () => {
    expect(() => requireApiKey(readRealtimeConfig({}))).toThrow(
      VoiceNotConfiguredError,
    );
    expect(requireApiKey(readRealtimeConfig({ OPENAI_API_KEY: 'k' }))).toBe('k');
  });
});
