import { beforeEach, describe, expect, it } from 'vitest';
import { checkRateLimit, clearRateLimits, rateLimitKeyCount } from './rate-limit';

describe('checkRateLimit', () => {
  beforeEach(() => clearRateLimits());

  it('should allow up to the limit and then refuse', () => {
    expect(checkRateLimit('k', 2, 1_000, 0)).toBe(true);
    expect(checkRateLimit('k', 2, 1_000, 10)).toBe(true);
    expect(checkRateLimit('k', 2, 1_000, 20)).toBe(false);
  });

  it('should allow again once the window has passed', () => {
    checkRateLimit('k', 1, 1_000, 0);

    expect(checkRateLimit('k', 1, 1_000, 999)).toBe(false);
    expect(checkRateLimit('k', 1, 1_000, 1_000)).toBe(true);
  });

  it('should count keys independently', () => {
    checkRateLimit('a', 1, 1_000, 0);

    expect(checkRateLimit('b', 1, 1_000, 0)).toBe(true);
  });

  it('should not count refused attempts against the window', () => {
    checkRateLimit('k', 1, 1_000, 0);
    checkRateLimit('k', 1, 1_000, 500);

    expect(checkRateLimit('k', 1, 1_000, 1_000)).toBe(true);
  });
});

describe('checkRateLimit key sweep', () => {
  beforeEach(() => clearRateLimits());

  it('should not keep every stale key forever', () => {
    for (let i = 0; i < 1_500; i += 1) {
      checkRateLimit(`ip:${i}`, 1, 1_000, 0);
    }

    checkRateLimit('fresh', 1, 1_000, 60 * 60_000);

    expect(rateLimitKeyCount()).toBeLessThan(10);
  });
});
