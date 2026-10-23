// Sliding-window rate limit, in memory (globalThis, see session-store.ts).

const HITS_KEY = Symbol.for('plantbase.voiceLive.rateLimit');
const globals = globalThis as { [HITS_KEY]?: Map<string, number[]> };
const hitsByKey: Map<string, number[]> = (globals[HITS_KEY] ??= new Map());

/** Records an attempt; returns false (and records nothing) when over the limit. */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const recent = (hitsByKey.get(key) ?? []).filter(
    (hit) => now - hit < windowMs,
  );
  if (recent.length >= limit) {
    hitsByKey.set(key, recent);
    return false;
  }
  hitsByKey.set(key, [...recent, now]);
  return true;
}

export function clearRateLimits(): void {
  hitsByKey.clear();
}
