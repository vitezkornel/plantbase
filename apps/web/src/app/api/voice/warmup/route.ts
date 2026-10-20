import 'server-only';
import { logger } from 'core';
import { warmFillers } from '../../../../voice/filler-cache';
import { safeErrorFields } from '../../../../voice/safe-error-fields';
import { synthesizeSpeech } from '../../../../voice/synthesize-speech';
import {
  NOT_CONFIGURED_MESSAGE,
  readVoiceConfig,
  VoiceNotConfiguredError,
} from '../../../../voice/voice-config';
import { createVoiceDeps } from '../../../../voice/voice-providers';

export const runtime = 'nodejs';

/** Starts generating the filler sentences in the background; answers at once. */
export function POST(): Response {
  let deps: ReturnType<typeof createVoiceDeps>;
  try {
    deps = createVoiceDeps(readVoiceConfig());
  } catch (error: unknown) {
    if (error instanceof VoiceNotConfiguredError) {
      logger.error('api_voice.not_configured');
      return Response.json({ error: NOT_CONFIGURED_MESSAGE }, { status: 503 });
    }
    throw error;
  }
  const idle = new AbortController().signal;
  void warmFillers({
    model: deps.config.ttsModel,
    voice: deps.config.voice,
    synthesize: (text) =>
      synthesizeSpeech({
        model: deps.speechModel,
        voice: deps.config.voice,
        text,
        signal: idle,
      }),
    onFailure: (error) =>
      logger.warn('api_voice.filler_warm_failed', safeErrorFields(error)),
  });
  return Response.json({ status: 'warming' }, { status: 202 });
}
