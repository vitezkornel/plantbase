// The HTTP layer of POST /api/voice: validate, then stream the turn as
// NDJSON. `getDeps` is a seam so tests (and the route) decide how the
// providers are built; it throws VoiceNotConfiguredError without a key.

import { logger } from 'core';
import { safeErrorFields } from './safe-error-fields';
import {
  NOT_CONFIGURED_MESSAGE,
  VoiceNotConfiguredError,
} from './voice-config';
import type { VoiceEvent } from './voice-events';
import type { VoiceDeps } from './voice-providers';
import { parseVoiceRequest, VoiceRequestError } from './voice-request-schema';
import { GENERIC_ERROR_MESSAGE, runVoiceTurn } from './voice-turn';

const INVALID_REQUEST_MESSAGE = 'Érvénytelen kérés.';

export async function handleVoiceRequest(
  request: Request,
  getDeps: () => VoiceDeps,
): Promise<Response> {
  let deps: VoiceDeps;
  try {
    deps = getDeps();
  } catch (error: unknown) {
    if (error instanceof VoiceNotConfiguredError) {
      logger.error('api_voice.not_configured');
      return Response.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
    }
    throw error;
  }

  let parsed: Awaited<ReturnType<typeof parseVoiceRequest>>;
  try {
    parsed = await parseVoiceRequest(await request.formData());
  } catch (error: unknown) {
    // Neither the form parser's nor our message quotes the input.
    logger.error('api_voice.invalid_request', safeErrorFields(error));
    return Response.json({ error: INVALID_REQUEST_MESSAGE }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: VoiceEvent): void => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // the client is gone (stream closed); nothing left to tell it
        }
      };
      try {
        await runVoiceTurn({
          deps,
          audio: parsed.audio,
          history: parsed.history,
          signal: request.signal,
          emit,
        });
      } catch (error: unknown) {
        if (request.signal.aborted) {
          logger.info('api_voice.aborted');
        } else if (error instanceof VoiceRequestError) {
          logger.warn('api_voice.rejected', safeErrorFields(error));
          emit({ type: 'error', message: error.message });
        } else {
          logger.error('api_voice.failed', safeErrorFields(error));
          emit({ type: 'error', message: GENERIC_ERROR_MESSAGE });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed by the client's cancel
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
