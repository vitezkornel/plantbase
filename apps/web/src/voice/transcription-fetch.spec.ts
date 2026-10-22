import { describe, expect, it, vi } from 'vitest';
import {
  createTranscriptionFetch,
  PLANT_KEYWORDS,
} from './transcription-fetch';

const URL_TRANSCRIPTIONS = 'https://api.openai.com/v1/audio/transcriptions';

function body(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  form.append('file', new File([new Uint8Array(3)], 'audio.webm'));
  return form;
}

function sentBody(base: ReturnType<typeof vi.fn>): FormData {
  return (base.mock.calls[0]?.[1] as RequestInit).body as FormData;
}

describe('createTranscriptionFetch', () => {
  it('should drop response_format and add languages and keywords for gpt-transcribe', async () => {
    const base = vi.fn().mockResolvedValue(new Response('{}'));
    const wrapped = createTranscriptionFetch(base);

    await wrapped(URL_TRANSCRIPTIONS, {
      method: 'POST',
      body: body({ model: 'gpt-transcribe', response_format: 'verbose_json' }),
    });

    const sent = sentBody(base);
    expect(sent.get('response_format')).toBeNull();
    expect(sent.getAll('languages[]')).toEqual(['hu']);
    expect(sent.getAll('keywords[]')).toEqual([...PLANT_KEYWORDS]);
    expect(sent.get('model')).toBe('gpt-transcribe');
    expect(sent.get('file')).toBeInstanceOf(File);
  });

  it('should never send both language and languages', async () => {
    const base = vi.fn().mockResolvedValue(new Response('{}'));

    await createTranscriptionFetch(base)(URL_TRANSCRIPTIONS, {
      method: 'POST',
      body: body({ model: 'gpt-transcribe', language: 'hu' }),
    });

    expect(sentBody(base).get('language')).toBeNull();
  });

  it('should leave other models untouched', async () => {
    const base = vi.fn().mockResolvedValue(new Response('{}'));
    const original = body({ model: 'gpt-4o-transcribe', language: 'hu' });

    await createTranscriptionFetch(base)(URL_TRANSCRIPTIONS, {
      method: 'POST',
      body: original,
    });

    expect(sentBody(base)).toBe(original);
  });

  it('should leave other URLs untouched', async () => {
    const base = vi.fn().mockResolvedValue(new Response('{}'));
    const original = body({ model: 'gpt-transcribe' });

    await createTranscriptionFetch(base)(
      'https://api.openai.com/v1/audio/speech',
      { method: 'POST', body: original },
    );

    expect(sentBody(base)).toBe(original);
  });
});

describe('PLANT_KEYWORDS', () => {
  it('should satisfy the API rules for keywords', () => {
    for (const keyword of PLANT_KEYWORDS) {
      expect(keyword).not.toMatch(/[<>\r\n]/);
      expect(keyword.trim()).toBe(keyword);
      expect(keyword.length).toBeGreaterThan(0);
    }
  });
});
