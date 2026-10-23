import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdleTimer, IDLE_MS, MAX_SESSION_MS } from './idle-timer';

describe('createIdleTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('should fire onIdle after five idle minutes', () => {
    const onIdle = vi.fn();
    createIdleTimer({ onIdle, onMaxDuration: vi.fn() });

    vi.advanceTimersByTime(IDLE_MS - 1);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('should restart the idle countdown on touch', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer({ onIdle, onMaxDuration: vi.fn() });

    vi.advanceTimersByTime(IDLE_MS - 1_000);
    timer.touch();
    vi.advanceTimersByTime(IDLE_MS - 1_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('should fire onMaxDuration at the hard cap even when kept busy', () => {
    const onMax = vi.fn();
    const timer = createIdleTimer({ onIdle: vi.fn(), onMaxDuration: onMax });

    for (let elapsed = 0; elapsed < MAX_SESSION_MS; elapsed += 60_000) {
      timer.touch();
      vi.advanceTimersByTime(60_000);
    }

    expect(onMax).toHaveBeenCalledTimes(1);
  });

  it('should stop everything and tolerate a second stop', () => {
    const onIdle = vi.fn();
    const onMax = vi.fn();
    const timer = createIdleTimer({ onIdle, onMaxDuration: onMax });

    timer.stop();
    timer.stop();
    vi.advanceTimersByTime(MAX_SESSION_MS * 2);

    expect(onIdle).not.toHaveBeenCalled();
    expect(onMax).not.toHaveBeenCalled();
  });

  it('should ignore touch after stop', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer({ onIdle, onMaxDuration: vi.fn() });
    timer.stop();

    timer.touch();
    vi.advanceTimersByTime(IDLE_MS * 2);

    expect(onIdle).not.toHaveBeenCalled();
  });
});
