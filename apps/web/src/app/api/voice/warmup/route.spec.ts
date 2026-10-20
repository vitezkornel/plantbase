import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearFillerCache } from '../../../../voice/filler-cache';
import { POST } from './route';

vi.mock('server-only', () => ({}));
vi.mock('../../../../voice/synthesize-speech', () => ({
  synthesizeSpeech: vi.fn(async () => new Uint8Array([1])),
}));

beforeEach(() => {
  clearFillerCache();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/voice/warmup', () => {
  it('should answer 503 with a Hungarian message when the API key is missing', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');

    const response = POST();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'A hangfunkció nincs beállítva (hiányzik az OPENAI_API_KEY).',
    });
  });

  it('should answer 202 and warm in the background when the key is set', () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');

    expect(POST().status).toBe(202);
  });
});
