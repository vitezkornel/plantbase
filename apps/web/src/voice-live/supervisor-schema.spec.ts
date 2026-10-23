import { describe, expect, it } from 'vitest';
import { SupervisorRequestSchema } from './supervisor-schema';

const id = '8f0c5a3e-6a47-4c43-8f3a-1d2b3c4d5e6f';

describe('SupervisorRequestSchema', () => {
  it('should accept a question and trim it', () => {
    expect(
      SupervisorRequestSchema.parse({
        sessionId: id,
        question: '  Mi a pothos?  ',
      }),
    ).toEqual({ sessionId: id, question: 'Mi a pothos?' });
  });

  it('should accept an optional approximate transcript', () => {
    expect(
      SupervisorRequestSchema.parse({
        sessionId: id,
        question: 'Mi a pothos?',
        approxTranscript: 'mi a potosz',
      }).approxTranscript,
    ).toBe('mi a potosz');
  });

  it.each([
    [{ sessionId: id, question: '' }],
    [{ sessionId: id, question: '   ' }],
    [{ sessionId: id, question: 'x'.repeat(501) }],
    [{ sessionId: id, question: 'ok', approxTranscript: 'x'.repeat(501) }],
    [{ sessionId: 'nem-uuid', question: 'ok' }],
    [{ question: 'ok' }],
    [{ sessionId: id, question: 'ok', role: 'system' }],
    [{ sessionId: id, question: 42 }],
  ])('should reject %j', (body) => {
    expect(SupervisorRequestSchema.safeParse(body).success).toBe(false);
  });

  it('should accept a question of exactly 500 characters', () => {
    expect(
      SupervisorRequestSchema.safeParse({
        sessionId: id,
        question: 'x'.repeat(500),
      }).success,
    ).toBe(true);
  });
});
