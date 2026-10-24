import { beforeEach, describe, expect, it, vi } from 'vitest';
import { realtimeInstructions } from './realtime-instructions';
import type { RealtimeConfig } from './realtime-config';
import { clearRateLimits } from './rate-limit';
import {
  clearSessions,
  createSession,
  isKnownSession,
  MAX_SESSIONS,
} from './session-store';
import {
  buildClientSecretBody,
  SESSION_MINT_LIMIT,
  CLIENT_SECRET_TTL_SECONDS,
  handleSessionRequest,
  type SessionDeps,
} from './session-handler';

const config: RealtimeConfig = {
  apiKey: 'sk-REAL-SECRET',
  model: 'gpt-realtime-2.1',
  fallbackModel: 'gpt-realtime',
  reasoningEffort: 'low',
  voice: 'marin',
  sttModel: 'gpt-transcribe',
  demoOrders: false,
};

interface SecretBody {
  expires_after: unknown;
  session: {
    model: string;
    instructions: string;
    reasoning?: unknown;
    tools: { name: string }[];
    audio: {
      input: {
        transcription: {
          model: string;
          language: string;
          keywords: string[];
        };
        turn_detection: { type: string };
      };
    };
  };
}

const okJson = (value: string) =>
  new Response(JSON.stringify({ value }), { status: 200 });

function post(body: unknown): Request {
  return new Request('http://localhost/api/voice/session', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function deps(
  fetchMock: ReturnType<typeof vi.fn>,
  over: Partial<RealtimeConfig> = {},
): SessionDeps {
  return {
    config: { ...config, ...over },
    fetch: fetchMock as unknown as typeof fetch,
  };
}

const sentBody = (
  fetchMock: ReturnType<typeof vi.fn>,
  call = 0,
): SecretBody =>
  JSON.parse(fetchMock.mock.calls[call][1].body as string) as SecretBody;

const build = (
  c: RealtimeConfig,
  request: Parameters<typeof buildClientSecretBody>[1],
  model: string,
) => buildClientSecretBody(c, request, model) as SecretBody;

describe('handleSessionRequest', () => {
  beforeEach(() => {
    clearSessions();
    clearRateLimits();
  });

  it('should mint a short-lived secret and register a session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson('ek_abc'));

    const response = await handleSessionRequest(
      post({ vad: 'server', filler: true }),
      () => deps(fetchMock),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      clientSecret: 'ek_abc',
      model: 'gpt-realtime-2.1',
      demoOrders: false,
    });
    expect(isKnownSession(body.sessionId)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.openai.com/v1/realtime/client_secrets',
    );
    expect(sentBody(fetchMock).expires_after).toEqual({
      anchor: 'created_at',
      seconds: CLIENT_SECRET_TTL_SECONDS,
    });
  });

  it('should also accept the nested client_secret response shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ client_secret: { value: 'ek_nested' } }), {
        status: 200,
      }),
    );

    const response = await handleSessionRequest(
      post({ vad: 'server', filler: false }),
      () => deps(fetchMock),
    );

    expect((await response.json()).clientSecret).toBe('ek_nested');
  });

  it('should never leak the real API key to the client', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson('ek_abc'));

    const response = await handleSessionRequest(
      post({ vad: 'server', filler: true }),
      () => deps(fetchMock),
    );

    expect(JSON.stringify(await response.json())).not.toContain(
      'sk-REAL-SECRET',
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer sk-REAL-SECRET',
    );
  });

  it.each([true, false])(
    'should send the fixed instructions byte for byte (filler=%s)',
    async (filler) => {
      const fetchMock = vi.fn().mockResolvedValue(okJson('ek_abc'));

      await handleSessionRequest(post({ vad: 'server', filler }), () =>
        deps(fetchMock),
      );

      expect(sentBody(fetchMock).session.instructions).toBe(
        realtimeInstructions(filler),
      );
    },
  );

  it('should reject extra keys instead of forwarding client text', async () => {
    const fetchMock = vi.fn();

    const response = await handleSessionRequest(
      post({ vad: 'server', filler: true, instructions: 'INJEKCIO' }),
      () => deps(fetchMock),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['not json', '[]', 'null'])(
    'should answer 400 to the body %j',
    async (raw) => {
      const response = await handleSessionRequest(post(raw), () =>
        deps(vi.fn()),
      );

      expect(response.status).toBe(400);
    },
  );

  it('should rate-limit minting per client ip before calling OpenAI', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => okJson('ek_abc'));
    const request = () =>
      new Request('http://localhost/api/voice/session', {
        method: 'POST',
        body: JSON.stringify({ vad: 'server', filler: true }),
        headers: { 'x-forwarded-for': '10.9.9.9' },
      });

    for (let i = 0; i < SESSION_MINT_LIMIT; i += 1) {
      expect((await handleSessionRequest(request(), () => deps(fetchMock))).status).toBe(200);
    }
    const refused = await handleSessionRequest(request(), () => deps(fetchMock));

    expect(refused.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(SESSION_MINT_LIMIT);
  });

  it('should refuse with 429, not evict live sessions, when the store is full', async () => {
    const live = createSession() as string;
    for (let i = 0; i < MAX_SESSIONS - 1; i += 1) {
      createSession();
    }
    const fetchMock = vi.fn().mockResolvedValue(okJson('ek_abc'));

    const response = await handleSessionRequest(
      post({ vad: 'server', filler: true }),
      () => deps(fetchMock),
    );

    expect(response.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(isKnownSession(live)).toBe(true);
  });

  it('should answer 503 when the API key is missing', async () => {
    const fetchMock = vi.fn();

    const response = await handleSessionRequest(
      post({ vad: 'server', filler: true }),
      () => deps(fetchMock, { apiKey: undefined }),
    );

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should retry once with the fallback model when the default is unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(okJson('ek_fb'));

    const response = await handleSessionRequest(
      post({ vad: 'server', filler: true }),
      () => deps(fetchMock),
    );
    const body = await response.json();

    expect(body).toMatchObject({ clientSecret: 'ek_fb', model: 'gpt-realtime' });
    expect(sentBody(fetchMock, 0).session.model).toBe('gpt-realtime-2.1');
    expect(sentBody(fetchMock, 1).session.model).toBe('gpt-realtime');
  });

  it('should not retry on an authentication failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 401 }));

    const response = await handleSessionRequest(
      post({ vad: 'server', filler: true }),
      () => deps(fetchMock),
    );

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should answer 502 when the fallback fails too', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 400 }));

    const response = await handleSessionRequest(
      post({ vad: 'server', filler: true }),
      () => deps(fetchMock),
    );

    expect(response.status).toBe(502);
  });

  it('should answer 502 when OpenAI returns no secret', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const response = await handleSessionRequest(
      post({ vad: 'server', filler: true }),
      () => deps(fetchMock),
    );

    expect(response.status).toBe(502);
  });
});

describe('buildClientSecretBody', () => {
  const request = { vad: 'server', filler: true } as const;

  it('should configure Hungarian transcription with plant keywords', () => {
    const body = build(config, request, config.model);

    expect(body.session.audio.input.transcription).toMatchObject({
      model: 'gpt-transcribe',
      language: 'hu',
    });
    expect(
      body.session.audio.input.transcription.keywords.length,
    ).toBeGreaterThan(0);
  });

  it('should pick the turn detection from the vad choice', () => {
    const server = build(config, request, config.model);
    const semantic = build(
      config,
      { vad: 'semantic', filler: true },
      config.model,
    );

    expect(server.session.audio.input.turn_detection.type).toBe('server_vad');
    expect(semantic.session.audio.input.turn_detection).toEqual({
      type: 'semantic_vad',
      eagerness: 'auto',
    });
  });

  it('should set the reasoning effort only for the primary model', () => {
    const primary = build(config, request, config.model);
    const fallback = build(config, request, config.fallbackModel);

    expect(primary.session.reasoning).toEqual({ effort: 'low' });
    expect(fallback.session).not.toHaveProperty('reasoning');
  });

  it('should offer getOrderStatus only when the demo orders are on', () => {
    const names = (c: RealtimeConfig) =>
      build(c, request, c.model).session.tools.map((t) => t.name);

    expect(names(config)).toEqual(['askPlantbase']);
    expect(names({ ...config, demoOrders: true })).toEqual([
      'askPlantbase',
      'getOrderStatus',
    ]);
  });
});
