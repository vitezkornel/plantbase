import { MockSpeechModelV2 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import {
  attemptTimeoutFor,
  hedgeDelayFor,
  synthesizeSpeech,
} from './synthesize-speech';

const AUDIO = new Uint8Array([1, 2, 3]);

type DoGenerate = NonNullable<
  ConstructorParameters<typeof MockSpeechModelV2>[0]
>['doGenerate'];

/** A model whose n-th call is `behaviours[n]`: 'hang' waits for the abort. */
function scriptedModel(behaviours: Array<'hang' | 'ok' | 'fail'>) {
  let calls = 0;
  const signals: Array<AbortSignal | undefined> = [];
  const doGenerate: DoGenerate = async ({ abortSignal }) => {
    const behaviour = behaviours[calls] ?? 'ok';
    calls += 1;
    signals.push(abortSignal);
    if (behaviour === 'fail') {
      throw Object.assign(new Error('boom'), { name: 'AI_APICallError' });
    }
    if (behaviour === 'hang') {
      await new Promise<never>((_, reject) => {
        abortSignal?.addEventListener('abort', () =>
          reject(abortSignal.reason),
        );
      });
    }
    return {
      audio: AUDIO,
      warnings: [],
      response: { timestamp: new Date(), modelId: 'mock', headers: {} },
    };
  };
  return {
    model: new MockSpeechModelV2({ doGenerate }),
    calls: () => calls,
    signals,
  };
}

const input = (model: MockSpeechModelV2, signal = new AbortController().signal) => ({
  model,
  voice: 'coral',
  text: 'Szia.',
  signal,
  attemptTimeoutMs: 40,
});

describe('synthesizeSpeech', () => {
  it('should return the audio bytes of a normal call', async () => {
    const { model, calls } = scriptedModel(['ok']);

    await expect(synthesizeSpeech(input(model))).resolves.toEqual(AUDIO);
    expect(calls()).toBe(1);
  });

  it('should retry a request that hangs past the attempt timeout', async () => {
    const { model, calls } = scriptedModel(['hang', 'hang', 'ok']);

    await expect(synthesizeSpeech(input(model))).resolves.toEqual(AUDIO);
    expect(calls()).toBe(3);
  });

  it('should give up with the timeout error after the last attempt', async () => {
    const { model, calls } = scriptedModel(['hang', 'hang', 'hang', 'ok']);

    await expect(synthesizeSpeech(input(model))).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    expect(calls()).toBe(3);
  });

  it('should not retry a provider error that answered', async () => {
    const { model, calls } = scriptedModel(['fail', 'ok']);

    await expect(synthesizeSpeech(input(model))).rejects.toMatchObject({
      name: 'AI_APICallError',
    });
    expect(calls()).toBe(1);
  });

  it('should not retry once the caller aborted', async () => {
    const controller = new AbortController();
    const { model, calls } = scriptedModel(['hang', 'ok']);

    const pending = synthesizeSpeech(input(model, controller.signal));
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(calls()).toBe(1);
  });

  describe('hedging', () => {
    const hedged = (model: MockSpeechModelV2) => ({
      ...input(model),
      attemptTimeoutMs: 1000,
      hedgeAfterMs: 20,
    });

    it('should start one parallel request when the first stays silent, and let it win', async () => {
      const { model, calls, signals } = scriptedModel(['hang', 'ok']);

      const startedAt = performance.now();
      await expect(synthesizeSpeech(hedged(model))).resolves.toEqual(AUDIO);

      expect(performance.now() - startedAt).toBeLessThan(500); // not the 1 s timeout
      expect(calls()).toBe(2);
      expect(signals[0]?.aborted).toBe(true); // the loser is cancelled
    });

    it('should not start a second request when the first answers in time', async () => {
      const { model, calls } = scriptedModel(['ok']);

      await synthesizeSpeech({ ...hedged(model), hedgeAfterMs: 200 });

      expect(calls()).toBe(1);
    });

    it('should start at most one extra request per attempt', async () => {
      const { model, calls } = scriptedModel(Array(6).fill('hang'));

      await expect(
        synthesizeSpeech({ ...hedged(model), attemptTimeoutMs: 80 }),
      ).rejects.toMatchObject({ name: 'TimeoutError' });

      expect(calls()).toBe(6); // 3 attempts x (1 + 1 extra)
    });

    it('should fail at once when the first request is refused before the delay', async () => {
      const { model, calls } = scriptedModel(['fail', 'ok']);

      await expect(
        synthesizeSpeech({ ...hedged(model), hedgeAfterMs: 200 }),
      ).rejects.toMatchObject({ name: 'AI_APICallError' });
      expect(calls()).toBe(1);
    });
  });
});

describe('hedgeDelayFor', () => {
  it('should hedge only the gpt-4o-mini-tts models', () => {
    expect(hedgeDelayFor('gpt-4o-mini-tts')).toBe(2000);
    expect(hedgeDelayFor('tts-1')).toBeUndefined();
    expect(hedgeDelayFor('tts-1-hd')).toBeUndefined();
  });
});

describe('attemptTimeoutFor', () => {
  it('should give a short sentence about the base silence timeout', () => {
    expect(attemptTimeoutFor('Szia.')).toBeGreaterThanOrEqual(5000);
    expect(attemptTimeoutFor('Szia.')).toBeLessThan(6000);
  });

  it('should wait longer for a long sentence than a slow short one takes', () => {
    // tts-1-hd took up to 5.6 s for a 24-character sentence
    expect(attemptTimeoutFor('x'.repeat(300))).toBeGreaterThan(15_000);
  });

  it('should grow with the length of the text', () => {
    expect(attemptTimeoutFor('x'.repeat(600))).toBeGreaterThan(
      attemptTimeoutFor('x'.repeat(300)),
    );
  });
});
