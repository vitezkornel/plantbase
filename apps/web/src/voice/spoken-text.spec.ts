import { describe, expect, it } from 'vitest';
import {
  CLOSING_SENTENCE,
  createSentenceSplitter,
  createSpokenBudget,
  stripMarkdown,
} from './spoken-text';

function splitAll(chunks: string[]): string[] {
  const splitter = createSentenceSplitter();
  return [...chunks.flatMap((c) => splitter.push(c)), ...splitter.flush()];
}

describe('createSentenceSplitter', () => {
  it('should emit a sentence only once its end is known', () => {
    const splitter = createSentenceSplitter();

    expect(splitter.push('Az első mondat.')).toEqual([]);
    expect(splitter.push(' A második')).toEqual(['Az első mondat.']);
    expect(splitter.flush()).toEqual(['A második']);
  });

  it('should not split at a Hungarian abbreviation', () => {
    expect(
      splitAll(['A ficus 2,5 m magas. Kb. 20 cm-es cserépben van. Szép.']),
    ).toEqual(['A ficus 2,5 m magas.', 'Kb. 20 cm-es cserépben van.', 'Szép.']);
  });

  it('should not split inside a decimal point or thousands grouping', () => {
    expect(splitAll(['Ára 2 490 Ft. Van 2.5 literes cserép is.'])).toEqual([
      'Ára 2 490 Ft.',
      'Van 2.5 literes cserép is.',
    ]);
  });

  it('should not split after list numbering at the start of a sentence', () => {
    expect(splitAll(['1. Először öntözz. Aztán várj.'])).toEqual([
      '1. Először öntözz.',
      'Aztán várj.',
    ]);
  });

  it('should split at a sentence-final number', () => {
    expect(splitAll(['Összesen 3. Köszönöm.'])).toEqual([
      'Összesen 3.',
      'Köszönöm.',
    ]);
  });

  it('should split on ? and ! and survive chunk boundaries inside a word', () => {
    expect(splitAll(['Szeretnél töb', 'bet tudni? Igen! Kérdezz.'])).toEqual([
      'Szeretnél többet tudni?',
      'Igen!',
      'Kérdezz.',
    ]);
  });
});

describe('stripMarkdown', () => {
  it('should remove emphasis, headings, list markers and links', () => {
    expect(
      stripMarkdown('## Cím\n- **Monstera** [itt](https://x.hu) _szép_ `kód`'),
    ).toBe('Cím Monstera itt szép kód');
  });

  it('should return an empty string for markdown-only input', () => {
    expect(stripMarkdown('**')).toBe('');
  });
});

describe('createSpokenBudget', () => {
  it('should let sentences through while the budget lasts', () => {
    const budget = createSpokenBudget(20);

    expect(budget.take('Rövid.')).toBe('Rövid.');
    expect(budget.take('Még egy.')).toBe('Még egy.');
  });

  it('should replace the first overflowing sentence with the closing line, then drop the rest', () => {
    const budget = createSpokenBudget(20);
    budget.take('Tizenkét betű.');

    expect(budget.take('Ez már túl hosszú mondat.')).toBe(CLOSING_SENTENCE);
    expect(budget.take('Ez sem.')).toBeNull();
  });

  it('should cut an over-long first sentence at a word boundary and close with the closing line', () => {
    const budget = createSpokenBudget(15);

    expect(budget.take('Ez egy nagyon hosszú mondat, ami nem fér bele.')).toBe(
      `Ez egy nagyon. ${CLOSING_SENTENCE}`,
    );
    expect(budget.take('Ez már nem hangzik el.')).toBeNull();
  });

  it('should keep a cut that ends exactly at a word boundary whole', () => {
    const budget = createSpokenBudget(9);

    expect(budget.take('Egy kettő hármas')).toBe(
      `Egy kettő. ${CLOSING_SENTENCE}`,
    );
  });

  it('should not eat the last letter of the last kept word', () => {
    const budget = createSpokenBudget(8);

    expect(budget.take('Sok fás nagyon hosszú')).toBe(
      `Sok fás. ${CLOSING_SENTENCE}`,
    );
  });

  it('should cut a single over-long word at the budget', () => {
    const budget = createSpokenBudget(5);

    expect(budget.take('Abcdefghijkl')).toBe(`Abcde. ${CLOSING_SENTENCE}`);
  });
});
