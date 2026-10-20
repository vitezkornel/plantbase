import { describe, expect, it } from 'vitest';
import { timingTone } from './timing-thresholds';

describe('timingTone', () => {
  it.each([
    [0, 'good'],
    [799, 'good'],
    [800, 'warn'],
    [1500, 'warn'],
    [1501, 'bad'],
    [6000, 'bad'],
  ] as const)('should classify %i ms as %s', (ms, tone) => {
    expect(timingTone(ms)).toBe(tone);
  });
});
