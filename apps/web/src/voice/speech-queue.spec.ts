import { describe, expect, it } from 'vitest';
import { createSpeechQueue, type SpokenSentence } from './speech-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createSpeechQueue', () => {
  it('should emit sentences in order even when a later one finishes first', async () => {
    const first = deferred<Uint8Array>();
    const second = deferred<Uint8Array>();
    const pending: Record<string, ReturnType<typeof deferred<Uint8Array>>> = {
      egy: first,
      kettő: second,
    };
    const emitted: SpokenSentence[] = [];
    const queue = createSpeechQueue({
      synthesize: (text) => pending[text]?.promise ?? Promise.reject(new Error(text)),
      onSentence: (sentence) => {
        emitted.push(sentence);
      },
    });

    queue.enqueue('egy');
    queue.enqueue('kettő');
    second.resolve(new Uint8Array([2]));
    await Promise.resolve();
    expect(emitted).toEqual([]);

    first.resolve(new Uint8Array([1]));
    await queue.finish();

    expect(emitted.map((s) => [s.index, s.text])).toEqual([
      [0, 'egy'],
      [1, 'kettő'],
    ]);
  });

  it('should run at most `concurrency` syntheses at once', async () => {
    let active = 0;
    let peak = 0;
    const queue = createSpeechQueue({
      concurrency: 2,
      synthesize: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return new Uint8Array([1]);
      },
      onSentence: () => undefined,
    });

    for (const text of ['a', 'b', 'c', 'd', 'e']) {
      queue.enqueue(text);
    }
    await queue.finish();

    expect(peak).toBe(2);
  });

  it('should report the synthesis time of each sentence', async () => {
    const times = [100, 142];
    const emitted: SpokenSentence[] = [];
    const queue = createSpeechQueue({
      now: () => times.shift() ?? 0,
      synthesize: async () => new Uint8Array([1]),
      onSentence: (sentence) => {
        emitted.push(sentence);
      },
    });

    queue.enqueue('szia');
    await queue.finish();

    expect(emitted[0]?.ttsMs).toBe(42);
  });

  it('should reject finish() when a synthesis fails, without unhandled rejections', async () => {
    const queue = createSpeechQueue({
      synthesize: async (text) => {
        if (text === 'rossz') {
          throw new Error('tts down');
        }
        return new Uint8Array([1]);
      },
      onSentence: () => undefined,
    });

    queue.enqueue('jó');
    queue.enqueue('rossz');
    queue.enqueue('utána');

    await expect(queue.finish()).rejects.toThrow('tts down');
  });
});
