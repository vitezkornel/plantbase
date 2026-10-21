import { APICallError } from 'ai';
import { MockSpeechModelV2 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_TTS_MODEL,
  isModelUnavailable,
  resetUnavailableModels,
  synthesizeWithFallback,
} from './tts-fallback';

const PRIMARY = new Uint8Array([1]);
const FALLBACK = new Uint8Array([2]);

function apiError(statusCode: number, code?: string): APICallError {
  return new APICallError({
    message: 'TITKOS mondat a hibában',
    url: 'https://api.openai.com/v1/audio/speech',
    requestBodyValues: { input: 'TITKOS mondat' },
    statusCode,
    data: code === undefined ? undefined : { error: { code } },
  });
}

function model(result: 'ok' | APICallError, audio: Uint8Array) {
  let calls = 0;
  const mock = new MockSpeechModelV2({
    doGenerate: async () => {
      calls += 1;
      if (result !== 'ok') {
        throw result;
      }
      return {
        audio,
        warnings: [],
        response: { timestamp: new Date(), modelId: 'mock', headers: {} },
      };
    },
  });
  return { mock, calls: () => calls };
}

let logged: string[];

beforeEach(() => {
  resetUnavailableModels();
  logged = [];
  const capture = (chunk: unknown) => {
    logged.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stdout, 'write').mockImplementation(capture);
  vi.spyOn(process.stderr, 'write').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function run(
  primary: ReturnType<typeof model>,
  fallback: ReturnType<typeof model> | undefined,
  text = 'Szia.',
) {
  return synthesizeWithFallback({
    deps: {
      config: { ttsModel: 'gpt-4o-mini-tts-2025-03-20', voice: 'coral' },
      speechModel: primary.mock,
      fallbackSpeechModel: fallback?.mock,
    },
    text,
    signal: new AbortController().signal,
  });
}

describe('isModelUnavailable', () => {
  it.each([
    ['a 404', apiError(404)],
    ['a 410', apiError(410)],
    ['model_not_found on a 400', apiError(400, 'model_not_found')],
    ['model_not_found on a 403', apiError(403, 'model_not_found')],
    ['a deprecated-model code', apiError(400, 'model_deprecated')],
  ])('should treat %s as an unavailable model', (_name, error) => {
    expect(isModelUnavailable(error)).toBe(true);
  });

  it.each([
    ['a 401', apiError(401)],
    ['a 429', apiError(429)],
    ['a 500', apiError(500)],
    ['a plain 400', apiError(400, 'invalid_request_error')],
    ['a timeout', Object.assign(new Error('x'), { name: 'TimeoutError' })],
    ['a non-error', 'x'],
  ])('should not treat %s as an unavailable model', (_name, error) => {
    expect(isModelUnavailable(error)).toBe(false);
  });
});

describe('synthesizeWithFallback', () => {
  it('should use the primary model while it works', async () => {
    const primary = model('ok', PRIMARY);
    const fallback = model('ok', FALLBACK);

    await expect(run(primary, fallback)).resolves.toEqual(PRIMARY);
    expect(fallback.calls()).toBe(0);
  });

  it('should regenerate the sentence with the fallback when the model is gone', async () => {
    const primary = model(apiError(404, 'model_not_found'), PRIMARY);
    const fallback = model('ok', FALLBACK);

    await expect(run(primary, fallback)).resolves.toEqual(FALLBACK);
    expect(fallback.calls()).toBe(1);
  });

  it('should remember a dead model and not try it again', async () => {
    const primary = model(apiError(404), PRIMARY);
    const fallback = model('ok', FALLBACK);

    await run(primary, fallback, 'Egy.');
    await run(primary, fallback, 'Kettő.');
    await run(primary, fallback, 'Három.');

    expect(primary.calls()).toBe(1);
    expect(fallback.calls()).toBe(3);
  });

  it('should log the switch once, without any text', async () => {
    const primary = model(apiError(404), PRIMARY);
    const fallback = model('ok', FALLBACK);

    await run(primary, fallback, 'Egy.');
    await run(primary, fallback, 'Kettő.');

    const lines = logged.filter((line) => line.includes('api_voice.tts_fallback'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('gpt-4o-mini-tts-2025-03-20');
    expect(lines[0]).toContain(FALLBACK_TTS_MODEL);
    expect(logged.join('')).not.toContain('TITKOS');
  });

  it('should not switch on an error that is not about the model', async () => {
    const primary = model(apiError(500), PRIMARY);
    const fallback = model('ok', FALLBACK);

    await expect(run(primary, fallback)).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(fallback.calls()).toBe(0);

    await expect(run(primary, fallback)).rejects.toBeDefined();
    expect(primary.calls()).toBe(2); // still tried: it is not marked dead
  });

  it('should rethrow when the model is gone and there is no fallback', async () => {
    const primary = model(apiError(404), PRIMARY);

    await expect(run(primary, undefined)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('should surface the fallback model failing too', async () => {
    const primary = model(apiError(404), PRIMARY);
    const fallback = model(apiError(500), FALLBACK);

    await expect(run(primary, fallback)).rejects.toMatchObject({
      statusCode: 500,
    });
  });
});
