import { describe, expect, it } from 'vitest';
import { createAttemptGuard } from './attempt-guard';

describe('createAttemptGuard', () => {
  it('should treat the latest attempt as current', () => {
    const guard = createAttemptGuard();

    const attempt = guard.begin();

    expect(guard.isCurrent(attempt)).toBe(true);
  });

  it('should make an earlier attempt stale when a newer one begins (press, release, press)', () => {
    const guard = createAttemptGuard();

    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('should make the running attempt stale on invalidate (released while the permission prompt is open)', () => {
    const guard = createAttemptGuard();
    const attempt = guard.begin();

    guard.invalidate();

    expect(guard.isCurrent(attempt)).toBe(false);
  });
});
