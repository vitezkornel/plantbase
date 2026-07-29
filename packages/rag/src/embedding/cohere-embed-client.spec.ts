import type { CohereClient } from 'cohere-ai';
import { describe, expect, it, vi } from 'vitest';
import { embedTexts } from './cohere-embed-client.js';

function makeFakeClient(vectors: number[][]): CohereClient {
  return {
    embed: vi.fn().mockResolvedValue({
      embeddings: { float: vectors },
    }),
  } as unknown as CohereClient;
}

describe('embedTexts', () => {
  it('calls Cohere embed with the given texts, input type, model, and output dimension', async () => {
    const client = makeFakeClient([[0.1, 0.2]]);

    await embedTexts(['hello world'], 'search_document', { client });

    expect(client.embed).toHaveBeenCalledWith(
      expect.objectContaining({
        texts: ['hello world'],
        inputType: 'search_document',
        model: 'embed-v4.0',
        embeddingTypes: ['float'],
      }),
    );
  });

  it('returns the float embeddings array from the response', async () => {
    const client = makeFakeClient([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);

    const result = await embedTexts(['a', 'b'], 'search_document', { client });

    expect(result).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
  });

  it('rejects an empty texts array without calling the client', async () => {
    const client = makeFakeClient([]);

    await expect(embedTexts([], 'search_document', { client })).rejects.toThrow();
    expect(client.embed).not.toHaveBeenCalled();
  });

  it('throws when the response is missing float embeddings', async () => {
    const client = {
      embed: vi.fn().mockResolvedValue({ embeddings: {} }),
    } as unknown as CohereClient;

    await expect(
      embedTexts(['hello'], 'search_document', { client }),
    ).rejects.toThrow();
  });
});
