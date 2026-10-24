import { MockLanguageModelV2, simulateReadableStream } from 'ai/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamAskAgent } from './ask-agent-stream.js';
import { anthropicOptionsFor } from './model-options.js';

describe('anthropicOptionsFor', () => {
  it('should leave text mode without any provider options, whatever the env says', () => {
    expect(anthropicOptionsFor('text', {})).toBeUndefined();
    expect(anthropicOptionsFor('text', { VOICE_THINKING: 'off' })).toBeUndefined();
    expect(anthropicOptionsFor('text', { VOICE_THINKING: 'low' })).toBeUndefined();
  });

  it.each(['voice', 'voice-live'] as const)(
    'should switch thinking off in %s mode by default',
    (mode) => {
      expect(anthropicOptionsFor(mode, {})).toEqual({
        anthropic: { thinking: { type: 'disabled' } },
      });
    },
  );

  it('should accept an effort level from VOICE_THINKING instead of switching it off', () => {
    expect(anthropicOptionsFor('voice-live', { VOICE_THINKING: 'low' })).toEqual({
      anthropic: { effort: 'low' },
    });
  });

  it('should leave the provider default when VOICE_THINKING is "default"', () => {
    expect(
      anthropicOptionsFor('voice-live', { VOICE_THINKING: 'default' }),
    ).toBeUndefined();
  });

  it('should fall back to off for an unknown value', () => {
    expect(anthropicOptionsFor('voice', { VOICE_THINKING: 'banana' })).toEqual({
      anthropic: { thinking: { type: 'disabled' } },
    });
  });
});

describe('streamAskAgent provider options', () => {
  afterEach(() => vi.unstubAllEnvs());

  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
  async function optionsSentFor(mode: 'text' | 'voice' | 'voice-live') {
    const model = new MockLanguageModelV2({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'ok' },
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: 'stop', usage },
          ],
        }),
      },
    });
    let logPath = '';
    const result = streamAskAgent([{ role: 'user', content: 'k' }], {
      model,
      mode,
      onLogWritten: (p) => (logPath = p),
    });
    await result.text;
    await vi.waitFor(() => expect(logPath).not.toBe(''));
    const { rm } = await import('node:fs/promises');
    await rm(logPath, { force: true });
    return model.doStreamCalls[0]?.providerOptions;
  }

  it('should send no provider options at all in text mode', async () => {
    vi.stubEnv('VOICE_THINKING', '');
    expect(await optionsSentFor('text')).toBeUndefined();
  });

  it('should send thinking disabled to the model in voice-live mode', async () => {
    vi.stubEnv('VOICE_THINKING', '');
    expect(await optionsSentFor('voice-live')).toEqual({
      anthropic: { thinking: { type: 'disabled' } },
    });
  });
});
