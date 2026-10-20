import { MockSpeechModelV2, MockTranscriptionModelV2 } from 'ai/test';
import { streamAskAgent } from 'core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFillerCache } from './filler-cache';
import { VoiceNotConfiguredError } from './voice-config';
import { handleVoiceRequest } from './voice-handler';
import type { VoiceDeps } from './voice-providers';

vi.mock('server-only', () => ({}));
vi.mock('core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('core')>()),
  streamAskAgent: vi.fn(),
}));

/** Distinctive user speech that must never appear in the ops log. */
const SECRET_TEXT = 'TITKOS-ATIRAT-4711';

let logged: string[];

beforeEach(() => {
  clearFillerCache();
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
  vi.mocked(streamAskAgent).mockReset();
});

function deps(options: { speechFails?: boolean } = {}): VoiceDeps {
  return {
    config: {
      apiKey: 'k',
      sttModel: 'gpt-transcribe',
      ttsModel: 'tts',
      voice: 'coral',
    },
    transcriptionModel: new MockTranscriptionModelV2({
      doGenerate: async () => ({
        text: SECRET_TEXT,
        segments: [],
        language: 'hu',
        durationInSeconds: 2,
        warnings: [],
        response: { timestamp: new Date(), modelId: 'mock', headers: {} },
      }),
    }),
    speechModel: new MockSpeechModelV2({
      doGenerate: async () => {
        if (options.speechFails) {
          throw Object.assign(new Error(`tts failed for ${SECRET_TEXT}`), {
            name: 'AI_APICallError',
            statusCode: 500,
          });
        }
        return {
          audio: new Uint8Array([1, 2, 3]),
          warnings: [],
          response: { timestamp: new Date(), modelId: 'mock', headers: {} },
        };
      },
    }),
  };
}

function agentSaying(...texts: string[]) {
  async function* parts() {
    for (const value of texts) {
      yield { type: 'text-delta' as const, id: 't', text: value };
    }
    yield { type: 'finish' as const };
  }
  vi.mocked(streamAskAgent).mockReturnValue({
    fullStream: parts(),
  } as unknown as ReturnType<typeof streamAskAgent>);
}

function post(
  fields: Record<string, string | Blob>,
  signal?: AbortSignal,
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }
  return new Request('http://localhost/api/voice', {
    method: 'POST',
    body: form,
    signal,
  });
}

const webm = () =>
  new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0])], {
    type: 'audio/webm;codecs=opus',
  });

async function eventsOf(
  response: Response,
): Promise<Array<{ type: string; message?: string }>> {
  const body = await response.text();
  return body
    .trim()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
}

describe('POST /api/voice (handler)', () => {
  it('should stream NDJSON events for a valid request', async () => {
    agentSaying('Van néhány kaktuszunk.');

    const response = await handleVoiceRequest(
      post({ audio: webm() }),
      () => deps(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(
      'application/x-ndjson',
    );
    const events = await eventsOf(response);
    expect(events.map((e) => e.type)).toEqual([
      'transcript',
      'text-delta',
      'sentence',
      'timing',
      'done',
    ]);
  });

  it.each([
    ['an unknown form field', { audio: webm(), extra: 'x' }],
    ['a missing audio', {}],
    ['a text/html upload', { audio: new Blob(['x'], { type: 'text/html' }) }],
    [
      'an oversized upload',
      {
        audio: new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], {
          type: 'audio/webm',
        }),
      },
    ],
  ])('should answer 400 for %s', async (_name, fields) => {
    const response = await handleVoiceRequest(post(fields), () => deps());

    expect(response.status).toBe(400);
    expect(streamAskAgent).not.toHaveBeenCalled();
  });

  it('should answer 400 for a body that is not a form', async () => {
    const response = await handleVoiceRequest(
      new Request('http://localhost/api/voice', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      }),
      () => deps(),
    );

    expect(response.status).toBe(400);
  });

  it('should answer 503 with a Hungarian message when the API key is missing', async () => {
    const response = await handleVoiceRequest(post({ audio: webm() }), () => {
      throw new VoiceNotConfiguredError();
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'A hangfunkció nincs beállítva (hiányzik az OPENAI_API_KEY).',
    });
  });

  it('should send an error event and log only name and status when the TTS fails', async () => {
    agentSaying('Valami.');

    const response = await handleVoiceRequest(post({ audio: webm() }), () =>
      deps({ speechFails: true }),
    );
    const events = await eventsOf(response);

    expect(events.find((e) => e.type === 'error')?.message).toBe(
      'Hiba történt a hangos válasz közben. Kérlek, próbáld újra.',
    );
    const all = logged.join('');
    expect(all).toContain('api_voice.failed');
    expect(all).toContain('AI_APICallError');
    expect(all).not.toContain(SECRET_TEXT);
  });

  it('should never put the transcript or the answer into the ops log', async () => {
    agentSaying('Ez a válasz sem kerülhet a naplóba.');

    const response = await handleVoiceRequest(
      post({ audio: webm() }),
      () => deps(),
    );
    await response.text();

    const all = logged.join('');
    expect(all).toContain('api_voice.completed');
    expect(all).not.toContain(SECRET_TEXT);
    expect(all).not.toContain('Ez a válasz');
  });

  it('should log an abort quietly and send no error event', async () => {
    const controller = new AbortController();
    async function* parts() {
      yield { type: 'text-delta' as const, id: 't', text: 'Elkezdem. ' };
      controller.abort();
      // What ai@5 streamText does when its abortSignal fires: it does not
      // throw, it emits an `abort` part and ends the stream normally.
      yield { type: 'abort' as const };
    }
    vi.mocked(streamAskAgent).mockReturnValue({
      fullStream: parts(),
    } as unknown as ReturnType<typeof streamAskAgent>);

    const response = await handleVoiceRequest(
      post({ audio: webm() }, controller.signal),
      () => deps(),
    );
    const events = await eventsOf(response);

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(logged.join('')).toContain('api_voice.aborted');
  });
});
