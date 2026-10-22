// Diagnostic round trip: the real SDK speech model and the real fetch wrapper
// against a local fake of OpenAI's /audio/speech (no real OpenAI call).

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createOpenAI } from '@ai-sdk/openai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { synthesizeSpeech } from './synthesize-speech';
import { createTranscriptionFetch } from './transcription-fetch';

const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]);

let server: Server;
let baseURL: string;
let seen: Array<{ url: string; body: string }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ url: req.url ?? '', body: Buffer.concat(chunks).toString() });
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      res.end(MP3);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => {
  server.close();
});

function speechModel(fetchImpl?: typeof fetch) {
  return createOpenAI({ apiKey: 'test', baseURL, fetch: fetchImpl }).speech(
    'gpt-4o-mini-tts',
  );
}

describe('TTS round trip against a local fake', () => {
  it('should read the mp3 bytes through the plain SDK fetch', async () => {
    const audio = await synthesizeSpeech({
      model: speechModel(),
      voice: 'coral',
      text: 'Szia.',
      signal: new AbortController().signal,
    });

    expect(Buffer.from(audio)).toEqual(MP3);
  });

  it('should read the mp3 bytes through the transcription fetch wrapper', async () => {
    seen = [];
    const audio = await synthesizeSpeech({
      model: speechModel(createTranscriptionFetch()),
      voice: 'coral',
      text: 'Szia.',
      signal: new AbortController().signal,
    });

    expect(Buffer.from(audio)).toEqual(MP3);
    expect(JSON.parse(seen[0].body)).toMatchObject({
      model: 'gpt-4o-mini-tts',
      input: 'Szia.',
      voice: 'coral',
    });
  });

  it('should read the bytes when the signal comes from a Request', async () => {
    const request = new Request('http://localhost/api/voice', {
      method: 'POST',
      body: 'x',
    });

    const audio = await synthesizeSpeech({
      model: speechModel(createTranscriptionFetch()),
      voice: 'coral',
      text: 'Szia.',
      signal: request.signal,
    });

    expect(Buffer.from(audio)).toEqual(MP3);
  });

  it('should run several syntheses at once with one shared signal', async () => {
    const { signal } = new AbortController();

    const results = await Promise.all(
      ['Egy.', 'Kettő.', 'Három.'].map((text) =>
        synthesizeSpeech({
          model: speechModel(createTranscriptionFetch()),
          voice: 'coral',
          text,
          signal,
        }),
      ),
    );

    expect(results.map((audio) => audio.length)).toEqual([12, 12, 12]);
  });
});
