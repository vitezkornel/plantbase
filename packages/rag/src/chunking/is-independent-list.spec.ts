import { describe, expect, it } from 'vitest';
import { isIndependentList } from './is-independent-list.js';

describe('isIndependentList', () => {
  it('treats a procedural "steps" heading as a coherent sequence (Minta B)', () => {
    const result = isIndependentList({
      articleTitle: 'To Pot or Not to Pot: Grow Pot vs Planter',
      sectionHeading: 'Steps to pot your plant',
    });

    expect(result).toBe(false);
  });

  it('treats a numbered "N Best" article title as an independent catalog (Minta C)', () => {
    const result = isIndependentList({
      articleTitle: '10 Best Plants for Beginner Gardeners',
      sectionHeading: '10 Beginner-Friendly Plants',
    });

    expect(result).toBe(true);
  });

  it('treats an enumerative question heading as an independent catalog (Minta D)', () => {
    const result = isIndependentList({
      articleTitle: 'Easy Indoor Plants That Can Survive Low Light',
      sectionHeading: 'What are some easy low light tolerant plants?',
    });

    expect(result).toBe(true);
  });

  it('defaults to coherent for an ordinary explanatory heading', () => {
    const result = isIndependentList({
      articleTitle: 'Easy Indoor Plants That Can Survive Low Light',
      sectionHeading: 'How do you care for low light plants?',
    });

    expect(result).toBe(false);
  });

  it('lets the procedural heading signal win even under a numbered-title article', () => {
    // A "how to" section nested inside an otherwise listicle-titled article
    // must still stay coherent — the heading-level signal takes precedence
    // over the article-title signal.
    const result = isIndependentList({
      articleTitle: '10 Best Plants for Beginner Gardeners',
      sectionHeading: 'How to plant your new garden bed',
    });

    expect(result).toBe(false);
  });
});
