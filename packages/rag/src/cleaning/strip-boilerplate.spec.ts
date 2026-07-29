import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseArticle } from '../parsing/parse-article.js';
import { stripBoilerplate } from './strip-boilerplate.js';

const SAMPLE_ARTICLES_DIR = fileURLToPath(
  new URL('../../../../data/knowledge', import.meta.url),
);

// Minta A–E (docs/dontesek-hf3.md #2–7) — every one of these carries the
// same recurring "Perfect Pairings" product block + "Words By The Sill"
// footer, confirmed present in all 202 articles (verified separately with
// grep -L over data/knowledge).
const SAMPLE_FILES = [
  'ask-the-sill__best-floor-planter.md',
  'care-miscellaneous__grow-pot.md',
  'outdoor-plant-care__best-plants-for-beginner-gardeners.md',
  'plants-101__low-light-houseplants.md',
  'plants-101__how-to-care-for-a-meyer-lemon-tree.md',
];

describe('stripBoilerplate', () => {
  it('cuts everything from the "Perfect Pairings" section onward, keeping the content before it', () => {
    const body = [
      '# Some Article',
      '',
      'Real, useful care content goes here.',
      '',
      '## Perfect Pairings For Your Plants',
      '',
      '* ### Premium Potting Mix',
      '',
      '  From $19',
      '',
      '##### Words By The Sill',
      '',
      'Empowering all people to be plant people...',
    ].join('\n');

    const result = stripBoilerplate(body);

    expect(result).toBe(
      '# Some Article\n\nReal, useful care content goes here.',
    );
  });

  it('returns the body unchanged when there is no boilerplate section', () => {
    const body = '# Some Article\n\nJust real content, no product block.';

    expect(stripBoilerplate(body)).toBe(body);
  });

  it.each(SAMPLE_FILES)(
    'strips the recurring product/footer boilerplate from %s while keeping real content',
    (fileName) => {
      const raw = readFileSync(`${SAMPLE_ARTICLES_DIR}/${fileName}`, 'utf-8');
      const { body } = parseArticle(raw);

      const result = stripBoilerplate(body);

      expect(result).not.toContain('Perfect Pairings For Your Plants');
      expect(result).not.toContain('Words By The Sill');
      expect(result).not.toContain('Best Seller');
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(body.length);
    },
  );
});
