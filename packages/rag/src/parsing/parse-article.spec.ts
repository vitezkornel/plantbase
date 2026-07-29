import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseArticle } from './parse-article.js';

const SAMPLE_ARTICLES_DIR = fileURLToPath(
  new URL('../../../../data/knowledge', import.meta.url),
);

// The five structurally-different articles identified in
// docs/dontesek-hf3.md (Minta A–E) — parsing must succeed on all of them.
const SAMPLE_FILES = [
  'ask-the-sill__best-floor-planter.md', // Minta A
  'care-miscellaneous__grow-pot.md', // Minta B
  'outdoor-plant-care__best-plants-for-beginner-gardeners.md', // Minta C
  'plants-101__low-light-houseplants.md', // Minta D
  'plants-101__how-to-care-for-a-meyer-lemon-tree.md', // Minta E
];

describe('parseArticle', () => {
  it('parses title, source, and category from front matter, and the body separately', () => {
    const raw = [
      '---',
      'title: The Best Light-Weight Floor Planter',
      'source: https://www.thesill.com/blogs/ask-the-sill/best-floor-planter',
      'category: ask-the-sill',
      '---',
      '',
      '# The Best Light-Weight Floor Planter',
      '',
      'Hi Annie! We feel your pain.',
    ].join('\n');

    const result = parseArticle(raw);

    expect(result.title).toBe('The Best Light-Weight Floor Planter');
    expect(result.source).toBe(
      'https://www.thesill.com/blogs/ask-the-sill/best-floor-planter',
    );
    expect(result.category).toBe('ask-the-sill');
    expect(result.body).toBe(
      '# The Best Light-Weight Floor Planter\n\nHi Annie! We feel your pain.',
    );
  });

  it('throws when the article has no front matter', () => {
    const raw = '# Just a heading\n\nNo front matter here.';

    expect(() => parseArticle(raw)).toThrow();
  });

  it('throws when front matter is missing a required field', () => {
    const raw = [
      '---',
      'title: Missing Source And Category',
      '---',
      '',
      'Body text.',
    ].join('\n');

    expect(() => parseArticle(raw)).toThrow();
  });

  it.each(SAMPLE_FILES)(
    'parses the real sample article %s without throwing',
    (fileName) => {
      const raw = readFileSync(`${SAMPLE_ARTICLES_DIR}/${fileName}`, 'utf-8');

      const result = parseArticle(raw);

      expect(result.title.length).toBeGreaterThan(0);
      expect(result.source).toMatch(/^https:\/\/www\.thesill\.com\//);
      expect(result.category.length).toBeGreaterThan(0);
      expect(result.body.length).toBeGreaterThan(0);
    },
  );
});
