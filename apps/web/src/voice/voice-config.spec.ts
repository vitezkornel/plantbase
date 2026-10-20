import { describe, expect, it } from 'vitest';
import { readVoiceConfig } from './voice-config';

describe('readVoiceConfig', () => {
  it('should use the defaults when nothing is set', () => {
    expect(readVoiceConfig({})).toEqual({
      apiKey: undefined,
      sttModel: 'gpt-transcribe',
      ttsModel: 'gpt-4o-mini-tts',
      voice: 'coral',
    });
  });

  it('should override the models and the voice from the environment', () => {
    const config = readVoiceConfig({
      OPENAI_API_KEY: 'sk-test',
      VOICE_STT_MODEL: 'gpt-4o-mini-transcribe',
      VOICE_TTS_MODEL: 'tts-1',
      VOICE_TTS_VOICE: 'alloy',
    });

    expect(config).toEqual({
      apiKey: 'sk-test',
      sttModel: 'gpt-4o-mini-transcribe',
      ttsModel: 'tts-1',
      voice: 'alloy',
    });
  });

  it('should treat empty values (as in .env.example) as unset', () => {
    const config = readVoiceConfig({ OPENAI_API_KEY: '', VOICE_STT_MODEL: '' });

    expect(config.apiKey).toBeUndefined();
    expect(config.sttModel).toBe('gpt-transcribe');
  });
});
