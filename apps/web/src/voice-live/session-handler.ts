// The HTTP layer of POST /api/voice/session: validate the (enum/bool only)
// request, mint a 60 s ephemeral client secret for a realtime session whose
// configuration is entirely ours, register a sessionId, answer. The real API
// key never leaves this file's `fetch` call.

import { logger } from 'core';
import { safeErrorFields } from '../voice/safe-error-fields';
import { PLANT_KEYWORDS } from '../voice/transcription-fetch';
import {
  NOT_CONFIGURED_MESSAGE,
  VoiceNotConfiguredError,
} from '../voice/voice-config';
import { requireApiKey, type RealtimeConfig } from './realtime-config';
import { realtimeInstructions } from './realtime-instructions';
import { ASK_PLANTBASE_TOOL, GET_ORDER_STATUS_TOOL } from './realtime-tools';
import {
  SessionRequestSchema,
  type SessionRequest,
} from './session-request-schema';
import { checkRateLimit, clientIp } from './rate-limit';
import { createSession, hasSessionCapacity } from './session-store';

export const CLIENT_SECRETS_URL =
  'https://api.openai.com/v1/realtime/client_secrets';
// The secret only has to live until the browser opens its call; a session
// that has started keeps running after it expires (OpenAI docs).
export const CLIENT_SECRET_TTL_SECONDS = 60;

// Every session is a paid OpenAI client_secrets call: bound minting per ip.
export const SESSION_MINT_LIMIT = 5;
const MINT_WINDOW_MS = 60_000;
const TOO_MANY_MESSAGE = 'Túl sok kérés, várj egy kicsit.';
const INVALID_REQUEST_MESSAGE = 'Érvénytelen kérés.';
const UPSTREAM_ERROR_MESSAGE = 'Nem sikerült hangmunkamenetet indítani.';

export interface SessionDeps {
  config: RealtimeConfig;
  fetch: typeof fetch;
}

export function buildClientSecretBody(
  config: RealtimeConfig,
  request: SessionRequest,
  model: string,
): object {
  const isPrimary = model === config.model;
  return {
    expires_after: {
      anchor: 'created_at',
      seconds: CLIENT_SECRET_TTL_SECONDS,
    },
    session: {
      type: 'realtime',
      model,
      instructions: realtimeInstructions(request.filler),
      // The fallback model may not support reasoning controls.
      ...(isPrimary ? { reasoning: { effort: config.reasoningEffort } } : {}),
      tools: config.demoOrders
        ? [ASK_PLANTBASE_TOOL, GET_ORDER_STATUS_TOOL]
        : [ASK_PLANTBASE_TOOL],
      tool_choice: 'auto',
      audio: {
        input: {
          // Guidance only, not what the model heard (OpenAI docs).
          transcription: {
            model: config.sttModel,
            language: 'hu',
            keywords: [...PLANT_KEYWORDS],
          },
          turn_detection:
            request.vad === 'semantic'
              ? { type: 'semantic_vad', eagerness: 'auto' }
              : { type: 'server_vad', silence_duration_ms: 500 },
        },
        output: { voice: config.voice },
      },
    },
  };
}

function extractClientSecret(json: unknown): string | undefined {
  if (typeof json !== 'object' || json === null) {
    return undefined;
  }
  if ('value' in json && typeof json.value === 'string') {
    return json.value;
  }
  if ('client_secret' in json) {
    const secret = json.client_secret;
    if (typeof secret === 'string') {
      return secret;
    }
    if (
      typeof secret === 'object' &&
      secret !== null &&
      'value' in secret &&
      typeof secret.value === 'string'
    ) {
      return secret.value;
    }
  }
  return undefined;
}

// A 400/404 means the model itself was refused; anything else (401, 429, 5xx)
// would fail the same way with the fallback model.
const isModelRefusal = (status: number): boolean =>
  status === 400 || status === 404;

async function mint(
  deps: SessionDeps,
  apiKey: string,
  request: SessionRequest,
  model: string,
): Promise<Response> {
  return deps.fetch(CLIENT_SECRETS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildClientSecretBody(deps.config, request, model)),
  });
}

const upstreamFailure = (): Response =>
  Response.json({ error: UPSTREAM_ERROR_MESSAGE }, { status: 502 });

export async function handleSessionRequest(
  request: Request,
  getDeps: () => SessionDeps,
): Promise<Response> {
  let deps: SessionDeps;
  let apiKey: string;
  try {
    deps = getDeps();
    apiKey = requireApiKey(deps.config);
  } catch (error: unknown) {
    if (error instanceof VoiceNotConfiguredError) {
      logger.error('api_voice_live.not_configured');
      return Response.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
    }
    throw error;
  }

  let parsed: SessionRequest;
  try {
    parsed = SessionRequestSchema.parse(await request.json());
  } catch (error: unknown) {
    logger.warn('api_voice_live.invalid_request', safeErrorFields(error));
    return Response.json({ error: INVALID_REQUEST_MESSAGE }, { status: 400 });
  }

  if (
    !checkRateLimit(
      `mint:${clientIp(request)}`,
      SESSION_MINT_LIMIT,
      MINT_WINDOW_MS,
    ) ||
    !hasSessionCapacity()
  ) {
    logger.warn('api_voice_live.session_rate_limited');
    return Response.json({ error: TOO_MANY_MESSAGE }, { status: 429 });
  }

  const startedAt = Date.now();
  let model = deps.config.model;
  try {
    let upstream = await mint(deps, apiKey, parsed, model);
    if (
      !upstream.ok &&
      isModelRefusal(upstream.status) &&
      deps.config.fallbackModel !== model
    ) {
      logger.warn('api_voice_live.session_fallback', {
        statusCode: upstream.status,
      });
      model = deps.config.fallbackModel;
      upstream = await mint(deps, apiKey, parsed, model);
    }
    if (!upstream.ok) {
      logger.error('api_voice_live.session_failed', {
        statusCode: upstream.status,
      });
      return upstreamFailure();
    }
    const clientSecret = extractClientSecret(await upstream.json());
    if (clientSecret === undefined) {
      logger.error('api_voice_live.session_failed', { errorName: 'NoSecret' });
      return upstreamFailure();
    }
    const sessionId = createSession();
    if (sessionId === null) {
      logger.warn('api_voice_live.session_rate_limited');
      return Response.json({ error: TOO_MANY_MESSAGE }, { status: 429 });
    }
    logger.info('api_voice_live.session_created', {
      ms: Date.now() - startedAt,
      model,
    });
    return Response.json({
      clientSecret,
      sessionId,
      model,
      demoOrders: deps.config.demoOrders,
    });
  } catch (error: unknown) {
    logger.error('api_voice_live.session_failed', safeErrorFields(error));
    return upstreamFailure();
  }
}
