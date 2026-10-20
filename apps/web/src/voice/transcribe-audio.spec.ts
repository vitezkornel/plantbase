import { MockTranscriptionModelV2 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { transcribeAudio } from './transcribe-audio';
import { VoiceRequestError } from './voice-request-schema';

function modelReturning(
  text: string,
  durationInSeconds: number | undefined = 3,
) {
  const calls: unknown[] = [];
  const model = new MockTranscriptionModelV2({
    doGenerate: async (options) => {
      calls.push(options);
      return {
        text,
        segments: [],
        language: 'hu',
        durationInSeconds,
        warnings: [],
        response: { timestamp: new Date(), modelId: 'mock', headers: {} },
      };
    },
  });
  return { model, calls };
}

const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]); // webm magic
const signal = new AbortController().signal;

describe('transcribeAudio', () => {
  it('should return the transcript', async () => {
    const { model } = modelReturning('Milyen kaktuszaitok vannak?');

    const result = await transcribeAudio({
      model,
      modelId: 'gpt-transcribe',
      audio,
      signal,
    });

    expect(result.text).toBe('Milyen kaktuszaitok vannak?');
  });

  it('should return an empty text when the model heard nothing', async () => {
    const { model } = modelReturning('');

    const result = await transcribeAudio({
      model,
      modelId: 'gpt-transcribe',
      audio,
      signal,
    });

    expect(result.text).toBe('');
  });

  it('should send no provider options for gpt-transcribe (the fetch wrapper adds the hints)', async () => {
    const { model, calls } = modelReturning('szia');
    await transcribeAudio({ model, modelId: 'gpt-transcribe', audio, signal });

    const { providerOptions } = calls[0] as {
      providerOptions?: { openai?: unknown };
    };
    expect(providerOptions?.openai).toBeUndefined();
  });

  it('should send language and prompt options for other models', async () => {
    const { model, calls } = modelReturning('szia');
    await transcribeAudio({
      model,
      modelId: 'gpt-4o-mini-transcribe',
      audio,
      signal,
    });

    const options = (
      calls[0] as { providerOptions: { openai: Record<string, string> } }
    ).providerOptions.openai;
    expect(options.language).toBe('hu');
    expect(options.prompt).toContain('monstera');
  });

  it('should reject a recording longer than the limit', async () => {
    const { model } = modelReturning('szia', 45);

    await expect(
      transcribeAudio({ model, modelId: 'gpt-transcribe', audio, signal }),
    ).rejects.toBeInstanceOf(VoiceRequestError);
  });
});
