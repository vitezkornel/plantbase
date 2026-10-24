import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProgressNudge,
  NUDGE_DELAY_MS,
  PROGRESS_NUDGE_INSTRUCTIONS,
} from './progress-nudge';

describe('createProgressNudge', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should nudge once after five seconds', () => {
    const onNudge = vi.fn();
    const nudge = createProgressNudge({ onNudge });
    nudge.start();

    vi.advanceTimersByTime(NUDGE_DELAY_MS - 1);
    expect(onNudge).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(onNudge).toHaveBeenCalledTimes(1);
  });

  it('should not nudge after cancel', () => {
    const onNudge = vi.fn();
    const nudge = createProgressNudge({ onNudge });
    nudge.start();
    nudge.cancel();

    vi.advanceTimersByTime(NUDGE_DELAY_MS * 2);

    expect(onNudge).not.toHaveBeenCalled();
  });

  it('should restart cleanly for the next tool call', () => {
    const onNudge = vi.fn();
    const nudge = createProgressNudge({ onNudge });
    nudge.start();
    vi.advanceTimersByTime(NUDGE_DELAY_MS);
    nudge.start();
    vi.advanceTimersByTime(NUDGE_DELAY_MS);

    expect(onNudge).toHaveBeenCalledTimes(2);
  });

  it('should keep claims out of the nudge instruction', () => {
    expect(PROGRESS_NUDGE_INSTRUCTIONS).toContain(
      'Még keresem, mindjárt mondom',
    );
    expect(PROGRESS_NUDGE_INSTRUCTIONS).toMatch(/ne állíts/i);
  });
});
