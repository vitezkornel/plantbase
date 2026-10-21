import { MockSpeechModelV2 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { synthesizeSpeech } from './synthesize-speech';

const AUDIO = new Uint8Array([1, 2, 3]);

type DoGenerate = NonNullable<
  ConstructorParameters<typeof MockSpeechModelV2>[0]
>['doGenerate'];

/** A model whose n-th call is `behaviours[n]`: 'hang' waits for the abort. */
function scriptedModel(behaviours: Array<'hang' | 'ok' | 'fail'>) {
  let calls = 0;
  const doGenerate: DoGenerate = async ({ abortSignal }) => {
    const behaviour = behaviours[calls] ?? 'ok';
    calls += 1;
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
  return { model: new MockSpeechModelV2({ doGenerate }), calls: () => calls };
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
});
