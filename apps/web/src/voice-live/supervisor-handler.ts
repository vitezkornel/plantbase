// The HTTP layer of POST /api/voice/supervisor.

import { ESCALATE_PREFIX, logger } from 'core';
import { splitEscalation } from '../chat/escalation';
import { safeErrorFields } from '../voice/safe-error-fields';
import { MAX_SPOKEN_CHARS } from '../voice/spoken-text';
import { checkRateLimit } from './rate-limit';
import { isKnownSession } from './session-store';
import { askSupervisor, type AskInput } from './supervisor-ask';
import {
  SupervisorRequestSchema,
  type SupervisorRequest,
} from './supervisor-schema';

export type { AskInput };

export const SUPERVISOR_TIMEOUT_MS = 20_000;
export const SESSION_LIMIT = 20;
export const IP_LIMIT = 40;
export const LIMIT_WINDOW_MS = 60_000;

const errors = {
  invalid: 'Érvénytelen kérés.',
  unknownSession: 'Ismeretlen vagy lejárt munkamenet.',
  tooMany: 'Túl sok kérés, várj egy kicsit.',
  timeout: 'A válasz túl sokáig tartott.',
  failed: 'Hiba történt a válasz kérésekor.',
} as const;

const fail = (message: string, status: number): Response =>
  Response.json({ error: message }, { status });

function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  );
}

export async function handleSupervisorRequest(
  request: Request,
  ask: (input: AskInput) => Promise<string> = askSupervisor,
  now: () => number = Date.now,
  timeoutMs: number = SUPERVISOR_TIMEOUT_MS,
): Promise<Response> {
  let parsed: SupervisorRequest;
  try {
    parsed = SupervisorRequestSchema.parse(await request.json());
  } catch (error: unknown) {
    logger.warn('api_voice_live.invalid_request', safeErrorFields(error));
    return fail(errors.invalid, 400);
  }

  if (!isKnownSession(parsed.sessionId, now())) {
    logger.warn('api_voice_live.unauthorized');
    return fail(errors.unknownSession, 401);
  }
  if (
    !checkRateLimit(
      `session:${parsed.sessionId}`,
      SESSION_LIMIT,
      LIMIT_WINDOW_MS,
      now(),
    ) ||
    !checkRateLimit(`ip:${clientIp(request)}`, IP_LIMIT, LIMIT_WINDOW_MS, now())
  ) {
    logger.warn('api_voice_live.rate_limited');
    return fail(errors.tooMany, 429);
  }

  // Our own timer (not AbortSignal.timeout) so the limit is injectable in tests.
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new Error('supervisor timeout')),
    timeoutMs,
  );
  const signal = AbortSignal.any([request.signal, timeout.signal]);
  const startedAt = now();
  try {
    const text = await ask({
      question: parsed.question,
      ...(parsed.approxTranscript === undefined
        ? {}
        : { clientTranscript: parsed.approxTranscript }),
      signal,
    });
    const { text: answer, isEscalated } = splitEscalation(
      text,
      ESCALATE_PREFIX,
    );
    logger.info('api_voice_live.supervisor_done', {
      ms: now() - startedAt,
      escalated: isEscalated,
    });
    return Response.json({
      answer: answer.slice(0, MAX_SPOKEN_CHARS),
      escalated: isEscalated,
    });
  } catch (error: unknown) {
    if (request.signal.aborted) {
      logger.info('api_voice_live.supervisor_aborted');
      return fail(errors.failed, 499);
    }
    if (timeout.signal.aborted) {
      logger.error('api_voice_live.supervisor_failed', {
        ms: now() - startedAt,
        errorName: 'TimeoutError',
      });
      return fail(errors.timeout, 504);
    }
    logger.error('api_voice_live.supervisor_failed', safeErrorFields(error));
    return fail(errors.failed, 502);
  } finally {
    clearTimeout(timer);
  }
}
