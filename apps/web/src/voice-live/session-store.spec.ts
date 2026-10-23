import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSessions,
  createSession,
  hasSessionCapacity,
  isKnownSession,
  MAX_SESSIONS,
  SESSION_TTL_MS,
} from './session-store';

describe('session store', () => {
  beforeEach(() => clearSessions());

  it('should know a fresh session', () => {
    const id = createSession(1_000) as string;

    expect(isKnownSession(id, 1_000)).toBe(true);
  });

  it('should forget a session after the TTL', () => {
    const id = createSession(1_000) as string;

    expect(isKnownSession(id, 1_000 + SESSION_TTL_MS - 1)).toBe(true);
    expect(isKnownSession(id, 1_000 + SESSION_TTL_MS)).toBe(false);
  });

  it('should not know an invented id', () => {
    expect(isKnownSession('8f0c5a3e-6a47-4c43-8f3a-1d2b3c4d5e6f')).toBe(false);
  });

  it('should refuse a new session when full of live ones instead of evicting', () => {
    const first = createSession(1);
    for (let i = 0; i < MAX_SESSIONS - 1; i += 1) {
      createSession(2 + i);
    }

    expect(hasSessionCapacity(10)).toBe(false);
    expect(createSession(10)).toBeNull();
    expect(isKnownSession(first as string, 10)).toBe(true);
  });

  it('should have capacity again once old sessions expired', () => {
    for (let i = 0; i < MAX_SESSIONS; i += 1) {
      createSession(1);
    }

    expect(hasSessionCapacity(1 + SESSION_TTL_MS)).toBe(true);
  });
});
