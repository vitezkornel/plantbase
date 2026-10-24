// Sliding-window rate limit, in memory (globalThis, see session-store.ts).

const HITS_KEY = Symbol.for('plantbase.voiceLive.rateLimit');
const globals = globalThis as { [HITS_KEY]?: Map<string, number[]> };
const hitsByKey: Map<string, number[]> = (globals[HITS_KEY] ??= new Map());

// Keys (one per session id / client ip) would otherwise pile up forever.
const SWEEP_ABOVE_KEYS = 500;
const RETAIN_MS = 5 * 60_000;

function sweep(now: number): void {
  if (hitsByKey.size <= SWEEP_ABOVE_KEYS) {
    return;
  }
  for (const [key, hits] of hitsByKey) {
    const newest = hits[hits.length - 1];
    if (newest === undefined || now - newest >= RETAIN_MS) {
      hitsByKey.delete(key);
    }
  }
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  );
}

/** Records an attempt; returns false (and records nothing) when over the limit. */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  sweep(now);
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

export function rateLimitKeyCount(): number {
  return hitsByKey.size;
}
