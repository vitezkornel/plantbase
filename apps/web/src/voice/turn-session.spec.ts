import { describe, expect, it, vi } from 'vitest';
import { createTurnSession } from './turn-session';

const audio = () => ({ stop: vi.fn() });

describe('createTurnSession', () => {
  it('should silence the speech and cancel the request in flight on interrupt', () => {
    const queue = audio();
    const session = createTurnSession(queue);
    const controller = session.begin();

    session.interrupt();

    expect(queue.stop).toHaveBeenCalledTimes(1);
    expect(controller.signal.aborted).toBe(true);
  });

  it('should only silence the speech when no request is in flight', () => {
    const queue = audio();

    expect(() => createTurnSession(queue).interrupt()).not.toThrow();
    expect(queue.stop).toHaveBeenCalledTimes(1);
  });

  it('should cancel an earlier request when a new one begins', () => {
    const session = createTurnSession(audio());
    const first = session.begin();

    const second = session.begin();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  it('should hand out a fresh request after an interrupt', () => {
    const session = createTurnSession(audio());
    session.begin();
    session.interrupt();

    expect(session.begin().signal.aborted).toBe(false);
  });

  it('should be safe to interrupt twice (barge-in, then leaving the page)', () => {
    const queue = audio();
    const session = createTurnSession(queue);
    const controller = session.begin();

    session.interrupt();
    session.interrupt();

    expect(controller.signal.aborted).toBe(true);
  });
});
