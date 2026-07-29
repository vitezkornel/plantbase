import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeChunkRecord } from '../storage/write-knowledge-chunks.js';
import { runIngest } from './run-ingest.js';

const ARTICLE_ONE = `---
title: Article One
source: https://example.com/one
category: plants-101
---

# Article One

Just one short paragraph, no subheadings.
`;

const ARTICLE_TWO = `---
title: Article Two
source: https://example.com/two
category: plants-101
---

# Article Two

##### First section

Some content in the first section.

##### Second section

Some content in the second section.
`;

describe('runIngest', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rag-ingest-test-'));
    await writeFile(join(dir, 'article-one.md'), ARTICLE_ONE, 'utf-8');
    await writeFile(join(dir, 'article-two.md'), ARTICLE_TWO, 'utf-8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('embeds each article once (batched per article) and writes one record per chunk', async () => {
    const embed = vi
      .fn()
      .mockImplementation(async (texts: string[]) =>
        texts.map(() => [0.1, 0.2, 0.3]),
      );
    const write = vi.fn().mockResolvedValue(undefined);

    const summary = await runIngest(dir, { embed, write });

    expect(summary.articlesProcessed).toBe(2);
    // article-one -> 1 chunk (preamble only), article-two -> 2 chunks
    expect(summary.chunksWritten).toBe(3);
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it('derives articleSlug from the filename and carries title/source/sectionPath through to the written records', async () => {
    const embed = vi
      .fn()
      .mockImplementation(async (texts: string[]) =>
        texts.map(() => [0.1, 0.2, 0.3]),
      );
    let writtenRecords: KnowledgeChunkRecord[] = [];
    const write = vi.fn().mockImplementation(async (records) => {
      writtenRecords = [...writtenRecords, ...records];
    });

    await runIngest(dir, { embed, write });

    const articleTwoRecords = writtenRecords.filter(
      (r) => r.articleSlug === 'article-two',
    );
    expect(articleTwoRecords).toHaveLength(2);
    expect(articleTwoRecords.every((r) => r.title === 'Article Two')).toBe(
      true,
    );
    expect(
      articleTwoRecords.every((r) => r.source === 'https://example.com/two'),
    ).toBe(true);
    expect(articleTwoRecords.map((r) => r.sectionPath).sort()).toEqual([
      'First section',
      'Second section',
    ]);
    expect(articleTwoRecords[0]?.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it('ignores non-markdown files in the directory', async () => {
    await writeFile(join(dir, 'notes.txt'), 'not an article', 'utf-8');
    const embed = vi
      .fn()
      .mockImplementation(async (texts: string[]) =>
        texts.map(() => [0.1, 0.2, 0.3]),
      );
    const write = vi.fn().mockResolvedValue(undefined);

    const summary = await runIngest(dir, { embed, write });

    expect(summary.articlesProcessed).toBe(2);
  });
});
