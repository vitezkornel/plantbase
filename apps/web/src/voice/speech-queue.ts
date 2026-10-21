// Sentences are synthesized in parallel (a small limit) but handed on
// strictly in their original order, so a quick second sentence never
// overtakes a slow first one.

export interface SpokenSentence {
  index: number;
  text: string;
  audio: Uint8Array;
  ttsMs: number;
}

export interface SpeechQueueOptions {
  synthesize: (text: string) => Promise<Uint8Array>;
  onSentence: (sentence: SpokenSentence) => void | Promise<void>;
  /** A sentence that could not be synthesized is skipped and reported here. */
  onFailure?: (index: number, error: unknown) => void;
  concurrency?: number;
  now?: () => number;
}

export interface SpeechQueue {
  enqueue(text: string): void;
  /** Resolves once every enqueued sentence has been handed on (or skipped); rejects only if handing one on throws. */
  finish(): Promise<void>;
}

export function createSpeechQueue({
  synthesize,
  onSentence,
  onFailure,
  concurrency = 2,
  now = () => performance.now(),
}: SpeechQueueOptions): SpeechQueue {
  let active = 0;
  const waiting: Array<() => void> = [];
  let nextIndex = 0;
  let chain: Promise<void> = Promise.resolve();

  const acquire = async (): Promise<void> => {
    if (active < concurrency) {
      active += 1;
      return;
    }
    // The slot is handed over by release(), `active` stays as it is.
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next === undefined) {
      active -= 1;
    } else {
      next();
    }
  };

  return {
    enqueue(text) {
      const index = nextIndex;
      nextIndex += 1;
      const synthesis = (async () => {
        await acquire();
        const startedAt = now();
        try {
          const audio = await synthesize(text);
          return { audio, ttsMs: Math.round(now() - startedAt) };
        } finally {
          release();
        }
      })();
      synthesis.catch(() => undefined); // handled in `chain`

      chain = chain.then(async () => {
        let spoken: Awaited<typeof synthesis>;
        try {
          spoken = await synthesis;
        } catch (error: unknown) {
          onFailure?.(index, error); // one lost sentence must not lose the turn
          return;
        }
        await onSentence({ index, text, ...spoken });
      });
      chain.catch(() => undefined); // surfaced through finish()
    },
    finish() {
      return chain;
    },
  };
}
