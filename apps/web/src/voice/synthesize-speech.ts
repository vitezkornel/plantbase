import { experimental_generateSpeech as generateSpeech } from 'ai';
import type { VoiceSpeechModel } from './voice-providers';

// gpt-4o-mini-tts sometimes accepts a request and then never answers (about
// every second call on 2026-10-21, from plain Node and curl as well; tts-1
// and the 2025-03-20 snapshot were unaffected), while a healthy call takes
// 1-3 s. Two defences:
//  - hedging (only for that model): if there is no answer after 2 s, one
//    parallel request is started and the first to finish wins;
//  - a silent attempt is given up on after 5 s and sent again (the net).
export const TTS_ATTEMPT_TIMEOUT_MS = 5_000;
// Generation takes longer for longer text, and the timeout covers the whole
// call (the body too), so a long sentence must not be taken for a silent one.
const TTS_ATTEMPT_PER_CHAR_MS = 40;
export const TTS_MAX_ATTEMPTS = 3;
const HEDGED_MODEL_PREFIX = 'gpt-4o-mini-tts';
const HEDGE_DELAY_MS = 2_000;

/** How long to wait before a parallel request; undefined = no hedging. */
export function hedgeDelayFor(modelId: string): number | undefined {
  return modelId.startsWith(HEDGED_MODEL_PREFIX) ? HEDGE_DELAY_MS : undefined;
}

/** The silence timeout of one attempt for this text. */
export function attemptTimeoutFor(text: string): number {
  return TTS_ATTEMPT_TIMEOUT_MS + TTS_ATTEMPT_PER_CHAR_MS * text.length;
}

export interface SynthesizeSpeechInput {
  model: VoiceSpeechModel;
  voice: string;
  text: string;
  signal: AbortSignal;
  attemptTimeoutMs?: number;
  /** Defaults from the model id (see hedgeDelayFor). */
  hedgeAfterMs?: number;
}

const modelIdOf = (model: VoiceSpeechModel): string =>
  typeof model === 'string' ? model : model.modelId;

/** One sentence → mp3 bytes. Retries only a request that stayed silent. */
export async function synthesizeSpeech({
  model,
  voice,
  text,
  signal,
  attemptTimeoutMs = attemptTimeoutFor(text),
  hedgeAfterMs = hedgeDelayFor(modelIdOf(model)),
}: SynthesizeSpeechInput): Promise<Uint8Array> {
  const request = async (abortSignal: AbortSignal): Promise<Uint8Array> => {
    const { audio } = await generateSpeech({
      model,
      text,
      voice,
      outputFormat: 'mp3',
      abortSignal,
      maxRetries: 0,
    });
    return audio.uint8Array;
  };

  for (let attempt = 1; ; attempt += 1) {
    const timeout = AbortSignal.timeout(attemptTimeoutMs);
    const attemptSignal = AbortSignal.any([signal, timeout]);
    try {
      return hedgeAfterMs === undefined
        ? await request(attemptSignal)
        : await hedged(request, attemptSignal, hedgeAfterMs);
    } catch (error: unknown) {
      const isSilent = timeout.aborted && !signal.aborted;
      if (!isSilent || attempt >= TTS_MAX_ATTEMPTS) {
        throw error;
      }
    }
  }
}

/**
 * Runs `start`, and if it has not settled after `delayMs` runs it once more
 * in parallel. The first success wins and cancels the other request. A
 * failure before the delay is final; after it, the other request decides.
 */
function hedged<T>(
  start: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  delayMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controllers: AbortController[] = [];
    let running = 0;
    let isSettled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const launch = (): void => {
      const controller = new AbortController();
      controllers.push(controller);
      running += 1;
      start(AbortSignal.any([signal, controller.signal])).then(
        (value) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timer);
            controllers.forEach((other) => other.abort());
            resolve(value);
          }
        },
        (error: unknown) => {
          running -= 1;
          if (!isSettled && running === 0) {
            isSettled = true;
            clearTimeout(timer);
            reject(error);
          }
        },
      );
    };

    launch();
    timer = setTimeout(() => {
      timer = undefined;
      if (!isSettled) {
        launch();
      }
    }, delayMs);
  });
}
