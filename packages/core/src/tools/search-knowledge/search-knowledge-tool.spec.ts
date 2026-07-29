import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { writeKnowledgeChunks } from 'rag';
import { afterAll, describe, expect, it, vi } from 'vitest';
import '../../config/env.js';
import {
  executeSearchKnowledge,
  searchKnowledgeTool,
} from './search-knowledge-tool.js';

const cleanupPool = new Pool({ connectionString: process.env['DATABASE_URL'] });

afterAll(async () => {
  await cleanupPool.end();
});

function unitVector(dimensionIndex: number): number[] {
  const vector = new Array(1536).fill(0);
  vector[dimensionIndex] = 1;
  return vector;
}

interface SearchKnowledgeResult {
  title: string;
  source: string;
  sectionPath: string | null;
  content: string;
  relevanceScore: number;
}

describe('executeSearchKnowledge — live DATABASE_URL_READONLY + write path integration', () => {
  it('returns the vector-closest chunk first after rerank, against the live (now real-data-populated) table', async () => {
    // The query embedding is set to be IDENTICAL to this row's stored
    // embedding (distance 0) — the single closest possible match by
    // construction, guaranteed to rank first regardless of how much real
    // ingested data (1552+ rows as of R4) also lives in knowledge_chunks.
    // An earlier version of this test asserted a "close" row ranked ahead
    // of a "far" row among the top-20 candidates — that broke once the
    // real ingest ran, because a merely-far synthetic vector is no longer
    // guaranteed to beat 1552 real embeddings into the top-20 cut.
    const articleSlug = `test-search-${randomUUID()}`;
    const closeVector = unitVector(0);

    await writeKnowledgeChunks([
      {
        articleSlug,
        title: 'Close Article',
        source: 'https://example.com/close',
        sectionPath: 'Section',
        content: 'Close content about Meyer lemons.',
        embedding: closeVector,
      },
    ]);

    try {
      const fakeGenerateHyde = vi.fn().mockResolvedValue('hypothetical passage');
      const fakeEmbed = vi.fn().mockResolvedValue([closeVector]);
      // Identity rerank for this test: keep candidate order as-is.
      const fakeRerank = vi
        .fn()
        .mockImplementation(async (_q: string, documents: string[], topN: number) =>
          documents
            .slice(0, topN)
            .map((_doc, index) => ({ index, relevanceScore: 1 - index * 0.1 })),
        );

      const outcome = await executeSearchKnowledge(
        { query: 'Meyer citromfa gondozása' },
        {
          generateHyde: fakeGenerateHyde,
          embed: fakeEmbed,
          rerank: fakeRerank,
        },
      );

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) {
        throw new Error('expected ok outcome');
      }
      const data = outcome.data as { results: SearchKnowledgeResult[] };
      expect(data.results[0]?.title).toBe('Close Article');
      expect(data.results[0]?.source).toBe('https://example.com/close');

      expect(fakeGenerateHyde).toHaveBeenCalledWith('Meyer citromfa gondozása');
      expect(fakeEmbed).toHaveBeenCalledWith(
        ['hypothetical passage'],
        'search_query',
      );
    } finally {
      await cleanupPool.query(
        'DELETE FROM knowledge_chunks WHERE article_slug = $1',
        [articleSlug],
      );
    }
  });

  it('returns an empty results array and never calls rerank when the vector search finds no candidates', async () => {
    // `search` is faked directly here (rather than relying on the live DB
    // happening to be empty) so this negative case is deterministic
    // regardless of ingest state.
    const fakeGenerateHyde = vi.fn().mockResolvedValue('hypothetical passage');
    const fakeEmbed = vi.fn().mockResolvedValue([unitVector(0)]);
    const fakeSearch = vi.fn().mockResolvedValue([]);
    const fakeRerank = vi.fn();

    const outcome = await executeSearchKnowledge(
      { query: 'valami aminek biztosan nincs találata' },
      {
        generateHyde: fakeGenerateHyde,
        embed: fakeEmbed,
        search: fakeSearch,
        rerank: fakeRerank,
      },
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const data = outcome.data as { results: SearchKnowledgeResult[] };
      expect(data.results).toEqual([]);
    }
    expect(fakeRerank).not.toHaveBeenCalled();
  });

  it('rejects empty query input without calling any dependency', async () => {
    const fakeGenerateHyde = vi.fn();
    const outcome = await executeSearchKnowledge(
      { query: '' },
      { generateHyde: fakeGenerateHyde },
    );

    expect(outcome.ok).toBe(false);
    expect(fakeGenerateHyde).not.toHaveBeenCalled();
  });
});

describe('searchKnowledgeTool — Anthropic-facing definition', () => {
  it('declares the tool name and a required query input', () => {
    expect(searchKnowledgeTool.definition.name).toBe('searchKnowledge');
    expect(searchKnowledgeTool.definition.input_schema).toMatchObject({
      type: 'object',
      required: ['query'],
    });
  });
});
