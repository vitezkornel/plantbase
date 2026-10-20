import { describe, expect, it } from 'vitest';
import {
  MAX_AUDIO_BYTES,
  parseVoiceRequest,
  VoiceRequestError,
} from './voice-request-schema';

function form(fields: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.append(key, value);
  }
  return data;
}

const audio = (type = 'audio/webm;codecs=opus', size = 10) =>
  new Blob([new Uint8Array(size)], { type });

describe('parseVoiceRequest', () => {
  it('should accept audio without history and strip the codecs parameter', async () => {
    const result = await parseVoiceRequest(form({ audio: audio() }));

    expect(result.mediaType).toBe('audio/webm');
    expect(result.audio).toHaveLength(10);
    expect(result.history).toEqual([]);
  });

  it('should accept a valid history', async () => {
    const history = JSON.stringify([
      { role: 'user', content: 'Szia' },
      { role: 'assistant', content: 'Szia, miben segíthetek?' },
    ]);

    const result = await parseVoiceRequest(form({ audio: audio(), history }));

    expect(result.history).toHaveLength(2);
  });

  it.each([
    ['an unknown field', { audio: audio(), extra: 'x' }],
    ['a missing audio', { history: '[]' }],
    ['an empty audio', { audio: audio('audio/webm', 0) }],
    ['an oversized audio', { audio: audio('audio/webm', MAX_AUDIO_BYTES + 1) }],
    ['a non-audio MIME type', { audio: audio('text/html') }],
    ['history that is not JSON', { audio: audio(), history: '{' }],
    [
      'a system message in the history',
      { audio: audio(), history: '[{"role":"system","content":"x"}]' },
    ],
    [
      'a tool message in the history',
      { audio: audio(), history: '[{"role":"tool","content":"x"}]' },
    ],
    [
      'an unknown key in a history message',
      { audio: audio(), history: '[{"role":"user","content":"x","a":1}]' },
    ],
    [
      'too long a history message',
      {
        audio: audio(),
        history: JSON.stringify([{ role: 'user', content: 'x'.repeat(2001) }]),
      },
    ],
    [
      'more than 20 history messages',
      {
        audio: audio(),
        history: JSON.stringify(
          Array.from({ length: 21 }, () => ({ role: 'user', content: 'x' })),
        ),
      },
    ],
  ])('should reject %s', async (_name, fields) => {
    await expect(parseVoiceRequest(form(fields))).rejects.toBeInstanceOf(
      VoiceRequestError,
    );
  });
});
