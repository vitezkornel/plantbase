import type { CohereClient } from 'cohere-ai';
import { describe, expect, it, vi } from 'vitest';
import { rerankDocuments } from './cohere-rerank-client.js';

function makeFakeClient(
  results: { index: number; relevanceScore: number }[],
): CohereClient {
  return {
    rerank: vi.fn().mockResolvedValue({ results }),
  } as unknown as CohereClient;
}

describe('rerankDocuments', () => {
  it('calls Cohere rerank with the query, documents, model, and topN', async () => {
    const client = makeFakeClient([{ index: 0, relevanceScore: 0.9 }]);

    await rerankDocuments('kérdés', ['doc a', 'doc b'], 5, { client });

    expect(client.rerank).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'kérdés',
        documents: ['doc a', 'doc b'],
        topN: 5,
        model: 'rerank-v4.0-pro',
      }),
    );
  });

  it('returns index + relevanceScore pairs from the response', async () => {
    const client = makeFakeClient([
      { index: 2, relevanceScore: 0.95 },
      { index: 0, relevanceScore: 0.4 },
    ]);

    const result = await rerankDocuments('q', ['a', 'b', 'c'], 2, { client });

    expect(result).toEqual([
      { index: 2, relevanceScore: 0.95 },
      { index: 0, relevanceScore: 0.4 },
    ]);
  });

  it('rejects an empty documents array without calling the client', async () => {
    const client = makeFakeClient([]);

    await expect(
      rerankDocuments('q', [], 5, { client }),
    ).rejects.toThrow();
    expect(client.rerank).not.toHaveBeenCalled();
  });
});
