import { logger } from 'core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRateLimits } from './rate-limit';
import { clearSessions, createSession } from './session-store';
import {
  handleSupervisorRequest,
  IP_LIMIT,
  SESSION_LIMIT,
  type AskInput,
} from './supervisor-handler';

function post(
  body: unknown,
  init: { signal?: AbortSignal; ip?: string } = {},
): Request {
  return new Request('http://localhost/api/voice/supervisor', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: init.signal,
    headers: { 'x-forwarded-for': init.ip ?? '10.0.0.1' },
  });
}

describe('handleSupervisorRequest', () => {
  let sessionId: string;
  beforeEach(() => {
    clearSessions();
    clearRateLimits();
    sessionId = createSession() as string;
  });

  const ask = (text: string) =>
    vi.fn<(input: AskInput) => Promise<string>>().mockResolvedValue(text);

  it('should answer with the agent text', async () => {
    const run = ask('A pothos könnyen gondozható.');

    const response = await handleSupervisorRequest(
      post({ sessionId, question: 'Mi a pothos?' }),
      run,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      answer: 'A pothos könnyen gondozható.',
      escalated: false,
    });
    expect(run.mock.calls[0][0].question).toBe('Mi a pothos?');
  });

  it('should strip the escalation prefix and flag it', async () => {
    const response = await handleSupervisorRequest(
      post({ sessionId, question: 'Hol a rendelésem?' }),
      ask('[ESCALATE] Egy kolléga jelentkezik.'),
    );

    expect(await response.json()).toEqual({
      answer: 'Egy kolléga jelentkezik.',
      escalated: true,
    });
  });

  it('should cap the length of the answer', async () => {
    const response = await handleSupervisorRequest(
      post({ sessionId, question: 'k' }),
      ask('a'.repeat(5000)),
    );

    expect((await response.json()).answer.length).toBeLessThanOrEqual(1200);
  });

  it('should pass the approximate transcript on for logging only', async () => {
    const run = ask('ok');

    await handleSupervisorRequest(
      post({
        sessionId,
        question: 'Mi a pothos?',
        approxTranscript: 'mi a potosz',
      }),
      run,
    );

    expect(run.mock.calls[0][0].clientTranscript).toBe('mi a potosz');
  });

  it.each([undefined, 'not-a-known-session'])(
    'should answer 401 to a missing or unknown session (%s)',
    async (bad) => {
      const run = ask('x');
      const body =
        bad === undefined
          ? { question: 'k' }
          : { sessionId: '8f0c5a3e-6a47-4c43-8f3a-1d2b3c4d5e6f', question: 'k' };

      const response = await handleSupervisorRequest(post(body), run);

      // a missing id fails the schema (400); an unknown uuid is a 401
      expect(response.status).toBe(bad === undefined ? 400 : 401);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('should answer 401 to an expired session', async () => {
    const run = ask('x');
    clearSessions();

    const response = await handleSupervisorRequest(
      post({ sessionId, question: 'k' }),
      run,
    );

    expect(response.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it('should answer 429 once the per-session limit is exceeded', async () => {
    const run = ask('ok');
    for (let i = 0; i < SESSION_LIMIT; i += 1) {
      const ok = await handleSupervisorRequest(
        post({ sessionId, question: 'k' }, { ip: `10.0.1.${i}` }),
        run,
      );
      expect(ok.status).toBe(200);
    }

    const response = await handleSupervisorRequest(
      post({ sessionId, question: 'k' }, { ip: '10.9.9.9' }),
      run,
    );

    expect(response.status).toBe(429);
  });

  it('should answer 429 once the per-IP limit is exceeded', async () => {
    const run = ask('ok');
    for (let i = 0; i < IP_LIMIT; i += 1) {
      const own = createSession();
      const ok = await handleSupervisorRequest(
        post({ sessionId: own, question: 'k' }, { ip: '10.7.7.7' }),
        run,
      );
      expect(ok.status).toBe(200);
    }

    const response = await handleSupervisorRequest(
      post({ sessionId: createSession(), question: 'k' }, { ip: '10.7.7.7' }),
      run,
    );

    expect(response.status).toBe(429);
  });

  it.each(['not json', '[]', 'null', '"text"'])(
    'should answer 400 (not 500) to the body %s',
    async (raw) => {
      const run = ask('x');

      const response = await handleSupervisorRequest(post(raw), run);

      expect(response.status).toBe(400);
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('should answer 400 to an over-long question and an extra key', async () => {
    const run = ask('x');

    expect(
      (
        await handleSupervisorRequest(
          post({ sessionId, question: 'x'.repeat(501) }),
          run,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleSupervisorRequest(
          post({ sessionId, question: 'k', system: 'x' }),
          run,
        )
      ).status,
    ).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('should answer 504 when the agent times out', async () => {
    const run = vi.fn(
      ({ signal }: AskInput) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(signal.reason ?? new Error('aborted')),
          );
        }),
    );

    // Real timers with an injected 20 ms limit instead of the real 20 s.
    const response = await handleSupervisorRequest(
      post({ sessionId, question: 'k' }),
      run,
      Date.now,
      20,
    );

    expect(response.status).toBe(504);
  });

  it('should answer 502 with a generic message when the agent fails', async () => {
    const run = vi
      .fn<(input: AskInput) => Promise<string>>()
      .mockRejectedValue(new Error('SECRET-DETAIL'));

    const response = await handleSupervisorRequest(
      post({ sessionId, question: 'k' }),
      run,
    );

    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain(
      'SECRET-DETAIL',
    );
  });

  it('should treat a client abort as aborted, not as a failure', async () => {
    const controller = new AbortController();
    const run = vi.fn(
      ({ signal }: AskInput) =>
        new Promise<string>((_resolve, reject) => {
          // Like the real SDK: an already-aborted signal rejects at once.
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    const pending = handleSupervisorRequest(
      post({ sessionId, question: 'k' }, { signal: controller.signal }),
      run,
    );
    await Promise.resolve();
    controller.abort();
    const response = await pending;

    expect(response.status).toBe(499);
  });

  it('should answer 504, not a partial 200, when the agent resolves after the timeout', async () => {
    // Like the real SDK after an abort: it resolves with the last closed step's text.
    const run = vi.fn(
      ({ signal }: AskInput) =>
        new Promise<string>((resolve) => {
          signal.addEventListener('abort', () => resolve('Megnézem a katalógust.'));
        }),
    );

    const response = await handleSupervisorRequest(
      post({ sessionId, question: 'k' }),
      run,
      Date.now,
      20,
    );

    expect(response.status).toBe(504);
  });

  it('should answer 499 when the agent resolves after a client abort', async () => {
    const controller = new AbortController();
    const run = vi.fn(
      ({ signal }: AskInput) =>
        new Promise<string>((resolve) => {
          if (signal.aborted) {
            resolve('félkész');
            return;
          }
          signal.addEventListener('abort', () => resolve('félkész'));
        }),
    );

    const pending = handleSupervisorRequest(
      post({ sessionId, question: 'k' }, { signal: controller.signal }),
      run,
    );
    await Promise.resolve();
    controller.abort();

    expect((await pending).status).toBe(499);
  });

  it('should answer 502 instead of an empty answer', async () => {
    const response = await handleSupervisorRequest(
      post({ sessionId, question: 'k' }),
      ask('   '),
    );

    expect(response.status).toBe(502);
  });


  describe('when the agent never settles and ignores the abort signal', () => {
    const hung = () =>
      vi.fn<(input: AskInput) => Promise<string>>(
        () => new Promise<string>(() => undefined),
      );

    afterEach(() => vi.restoreAllMocks());

    it('should still answer 504 at the time limit', async () => {
      const response = await handleSupervisorRequest(
        post({ sessionId, question: 'k' }),
        hung(),
        Date.now,
        20,
      );

      expect(response.status).toBe(504);
    });

    it('should answer 499 at once when the client aborts', async () => {
      const controller = new AbortController();
      const pending = handleSupervisorRequest(
        post({ sessionId, question: 'k' }, { signal: controller.signal }),
        hung(),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();

      expect((await pending).status).toBe(499);
    });
  });

  describe('exit logging', () => {
    afterEach(() => vi.restoreAllMocks());

    it('should log supervisor_timeout with the elapsed ms', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

      await handleSupervisorRequest(
        post({ sessionId, question: 'k' }),
        vi.fn(() => new Promise<string>(() => undefined)),
        Date.now,
        20,
      );

      expect(error).toHaveBeenCalledWith(
        'api_voice_live.supervisor_timeout',
        expect.objectContaining({ ms: expect.any(Number) }),
      );
    });

    it('should log supervisor_aborted with the elapsed ms', async () => {
      const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
      const controller = new AbortController();
      const pending = handleSupervisorRequest(
        post({ sessionId, question: 'k' }, { signal: controller.signal }),
        vi.fn(() => new Promise<string>(() => undefined)),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();
      await pending;

      expect(info).toHaveBeenCalledWith(
        'api_voice_live.supervisor_aborted',
        expect.objectContaining({ ms: expect.any(Number) }),
      );
    });
  });
});
