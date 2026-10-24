import { describe, expect, it } from 'vitest';
import { MAX_QUESTION_CHARS } from './supervisor-schema';
import { clampQuestion, parseSupervisorResponse } from './supervisor-client';

describe('parseSupervisorResponse', () => {
  it('should accept an ok answer', () => {
    expect(
      parseSupervisorResponse({ answer: 'Szia', escalated: false }),
    ).toEqual({ answer: 'Szia', escalated: false });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a missing answer', { escalated: false }],
    ['a non-string answer', { answer: 3, escalated: false }],
    ['a missing escalated flag', { answer: 'x' }],
    ['an error body', { error: 'Túl sok kérés' }],
  ])('should throw on %s so the model gets an error output', (_name, body) => {
    expect(() => parseSupervisorResponse(body)).toThrow();
  });

  it('should keep the server-measured time when present', () => {
    expect(
      parseSupervisorResponse({ answer: 'x', escalated: false, serverMs: 5876 }),
    ).toEqual({ answer: 'x', escalated: false, serverMs: 5876 });
  });

  it('should drop unknown keys', () => {
    expect(
      parseSupervisorResponse({ answer: 'x', escalated: true, extra: 1 }),
    ).toEqual({ answer: 'x', escalated: true });
  });
});

describe('clampQuestion', () => {
  it('should leave a short question unchanged', () => {
    expect(clampQuestion('Mennyibe kerül?')).toBe('Mennyibe kerül?');
  });

  it('should cut a question over the server limit', () => {
    expect(clampQuestion('a'.repeat(MAX_QUESTION_CHARS + 50))).toHaveLength(
      MAX_QUESTION_CHARS,
    );
  });

  it('should not split a surrogate pair at the cut', () => {
    const text = 'a'.repeat(MAX_QUESTION_CHARS - 1) + '😀';
    const cut = clampQuestion(text);
    expect(cut.length).toBeLessThanOrEqual(MAX_QUESTION_CHARS);
    expect(cut).not.toMatch(/[\ud800-\udbff]$/);
  });
});
