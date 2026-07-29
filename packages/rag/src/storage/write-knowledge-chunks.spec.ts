import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import '../config/env.js';
import {
  closeWritePool,
  writeKnowledgeChunks,
} from './write-knowledge-chunks.js';

// Live integration test against the compose Postgres (konvenciok.md /
// architektura.md #2 pattern: packages/core's run-sql/list-categories tests
// and packages/db's readonly-role.spec.ts already do this, not mocked).
// Requires `docker compose up -d` + migrations applied.
const verifyPool = new Pool({ connectionString: process.env['DATABASE_URL'] });

function fakeEmbedding(): number[] {
  return Array.from({ length: 1536 }, () => Math.random());
}

afterAll(async () => {
  await verifyPool.end();
  await closeWritePool();
});

describe('writeKnowledgeChunks — live DATABASE_URL integration', () => {
  it('persists a chunk record with a computed content hash and the stored embedding', async () => {
    const articleSlug = `test-article-${randomUUID()}`;
    const embedding = fakeEmbedding();

    await writeKnowledgeChunks([
      {
        articleSlug,
        title: 'Test Article',
        source: 'https://example.com/test-article',
        sectionPath: 'Test Section',
        content: 'Some test content.',
        embedding,
      },
    ]);

    const result = await verifyPool.query(
      `SELECT title, source, section_path, content, content_hash,
              (embedding <-> $2::vector) AS self_distance
       FROM knowledge_chunks WHERE article_slug = $1`,
      [articleSlug, `[${embedding.join(',')}]`],
    );

    expect(result.rowCount).toBe(1);
    const row = result.rows[0];
    expect(row.title).toBe('Test Article');
    expect(row.source).toBe('https://example.com/test-article');
    expect(row.section_path).toBe('Test Section');
    expect(row.content).toBe('Some test content.');
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(row.self_distance)).toBeCloseTo(0, 5);

    await verifyPool.query('DELETE FROM knowledge_chunks WHERE article_slug = $1', [
      articleSlug,
    ]);
  });

  it('persists a null section_path as null (article preamble chunks)', async () => {
    const articleSlug = `test-article-${randomUUID()}`;

    await writeKnowledgeChunks([
      {
        articleSlug,
        title: 'Preamble Test',
        source: 'https://example.com/preamble-test',
        sectionPath: null,
        content: 'Preamble content.',
        embedding: fakeEmbedding(),
      },
    ]);

    const result = await verifyPool.query(
      'SELECT section_path FROM knowledge_chunks WHERE article_slug = $1',
      [articleSlug],
    );

    expect(result.rows[0].section_path).toBeNull();

    await verifyPool.query('DELETE FROM knowledge_chunks WHERE article_slug = $1', [
      articleSlug,
    ]);
  });

  it('writes multiple records from one article in one call', async () => {
    const articleSlug = `test-article-${randomUUID()}`;

    await writeKnowledgeChunks([
      {
        articleSlug,
        title: 'Multi Chunk Test',
        source: 'https://example.com/multi',
        sectionPath: 'Section A',
        content: 'Content A.',
        embedding: fakeEmbedding(),
      },
      {
        articleSlug,
        title: 'Multi Chunk Test',
        source: 'https://example.com/multi',
        sectionPath: 'Section B',
        content: 'Content B.',
        embedding: fakeEmbedding(),
      },
    ]);

    const result = await verifyPool.query(
      'SELECT section_path FROM knowledge_chunks WHERE article_slug = $1 ORDER BY section_path',
      [articleSlug],
    );

    expect(result.rowCount).toBe(2);
    expect(result.rows.map((r) => r.section_path)).toEqual([
      'Section A',
      'Section B',
    ]);

    await verifyPool.query('DELETE FROM knowledge_chunks WHERE article_slug = $1', [
      articleSlug,
    ]);
  });
});
