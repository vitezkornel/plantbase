import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripBoilerplate } from '../cleaning/strip-boilerplate.js';
import { parseArticle } from '../parsing/parse-article.js';
import { chunkArticle } from './chunk-article.js';

const SAMPLE_ARTICLES_DIR = fileURLToPath(
  new URL('../../../../data/knowledge', import.meta.url),
);

function loadCleanedArticle(fileName: string) {
  const raw = readFileSync(`${SAMPLE_ARTICLES_DIR}/${fileName}`, 'utf-8');
  const parsed = parseArticle(raw);
  return { ...parsed, body: stripBoilerplate(parsed.body) };
}

describe('chunkArticle', () => {
  it('keeps a sequential steps list in a single chunk (Minta B)', () => {
    const article = loadCleanedArticle('care-miscellaneous__grow-pot.md');

    const chunks = chunkArticle(article);
    const stepsChunks = chunks.filter(
      (c) => c.sectionPath === 'Steps to pot your plant',
    );

    expect(stepsChunks).toHaveLength(1);
    expect(stepsChunks[0]?.content).toContain(
      'Remove plant from nursery grow pot',
    );
    expect(stepsChunks[0]?.content).toContain('Water and enjoy');
  });

  it('does not split the bullet "reasons" lists in Minta B', () => {
    const article = loadCleanedArticle('care-miscellaneous__grow-pot.md');

    const chunks = chunkArticle(article);
    const reasonChunks = chunks.filter(
      (c) => c.sectionPath === 'Why some prefer nursery grow pots',
    );

    expect(reasonChunks).toHaveLength(1);
    expect(reasonChunks[0]?.content).toContain('Ease of watering');
    expect(reasonChunks[0]?.content).toContain('Time of year');
  });

  it('splits an independent plant catalog into one chunk per item (Minta C)', () => {
    const article = loadCleanedArticle(
      'outdoor-plant-care__best-plants-for-beginner-gardeners.md',
    );

    const chunks = chunkArticle(article);
    const plantChunks = chunks.filter(
      (c) => c.sectionPath === '10 Beginner-Friendly Plants',
    );

    expect(plantChunks).toHaveLength(10);
    const japaneseMapleChunk = plantChunks.find((c) =>
      c.content.includes('Japanese Maples'),
    );
    const juneHostaChunk = plantChunks.find((c) =>
      c.content.includes('June Hosta'),
    );
    expect(japaneseMapleChunk).toBeDefined();
    expect(juneHostaChunk).toBeDefined();
    expect(japaneseMapleChunk?.content).not.toContain('June Hosta');
    expect(juneHostaChunk?.content).not.toContain('Japanese Maples');
  });

  it('splits an embedded independent plant list nested inside an otherwise coherent article (Minta D)', () => {
    const article = loadCleanedArticle('plants-101__low-light-houseplants.md');

    const chunks = chunkArticle(article);
    const plantChunks = chunks.filter(
      (c) => c.sectionPath === 'What are some easy low light tolerant plants?',
    );
    const explanationChunks = chunks.filter(
      (c) => c.sectionPath === 'What is a low light plant?',
    );

    expect(plantChunks).toHaveLength(6);
    const snakePlantChunk = plantChunks.find((c) =>
      c.content.includes('Snake Plant'),
    );
    expect(snakePlantChunk).toBeDefined();
    expect(snakePlantChunk?.content).not.toContain('ZZ Plant');

    // The earlier, genuinely coherent explanatory section must stay whole.
    expect(explanationChunks).toHaveLength(1);
  });

  it('produces a small preamble + single-answer chunk set for a short Q&A article (Minta A)', () => {
    const article = loadCleanedArticle('ask-the-sill__best-floor-planter.md');

    const chunks = chunkArticle(article);

    expect(chunks.length).toBe(2);
    expect(chunks.every((c) => c.title === article.title)).toBe(true);
    expect(chunks.every((c) => c.source === article.source)).toBe(true);
    expect(chunks.some((c) => c.content.includes('Hi Annie!'))).toBe(true);
  });

  it('splits each FAQ question into its own chunk and skips empty sections (Minta E)', () => {
    const article = loadCleanedArticle(
      'plants-101__how-to-care-for-a-meyer-lemon-tree.md',
    );

    const chunks = chunkArticle(article);

    expect(chunks.every((c) => c.content.trim().length > 0)).toBe(true);
    expect(
      chunks.some((c) => c.content.includes('toxic to dogs and cats')),
    ).toBe(true);
    expect(
      chunks.some((c) =>
        c.content.includes('Meyer lemon bush and a Meyer lemon tree'),
      ),
    ).toBe(true);
    // The toxicity answer and the bush-vs-tree answer must land in
    // different chunks (each FAQ question got its own heading-based split).
    const toxicityChunk = chunks.find((c) =>
      c.content.includes('toxic to dogs and cats'),
    );
    expect(toxicityChunk).toBeDefined();
    expect(toxicityChunk?.content).not.toContain(
      'Meyer lemon bush and a Meyer lemon tree',
    );
  });
});
