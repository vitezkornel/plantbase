// In-memory session ids for /voice/live. NOT user authentication: it only
// ties a supervisor call to a session this server minted (spec §8). Held on
// globalThis because Next bundles every route separately — a module-level Map
// would be one store per route (same lesson as voice/filler-cache.ts).

export const SESSION_TTL_MS = 30 * 60_000;
export const MAX_SESSIONS = 200;

const STORE_KEY = Symbol.for('plantbase.voiceLive.sessions');
const globals = globalThis as { [STORE_KEY]?: Map<string, number> };
const sessions: Map<string, number> = (globals[STORE_KEY] ??= new Map());

function dropExpired(now: number): void {
  for (const [id, expiresAt] of sessions) {
    if (expiresAt <= now) {
      sessions.delete(id);
    }
  }
}

/** False when MAX_SESSIONS live sessions exist: we refuse rather than evict. */
export function hasSessionCapacity(now: number = Date.now()): boolean {
  dropExpired(now);
  return sessions.size < MAX_SESSIONS;
}

/** Null when full: a flood of new sessions must not push out live ones. */
export function createSession(now: number = Date.now()): string | null {
  if (!hasSessionCapacity(now)) {
    return null;
  }
  const id = crypto.randomUUID();
  sessions.set(id, now + SESSION_TTL_MS);
  return id;
}

export function isKnownSession(id: string, now: number = Date.now()): boolean {
  const expiresAt = sessions.get(id);
  return expiresAt !== undefined && expiresAt > now;
}

export function clearSessions(): void {
  sessions.clear();
}
