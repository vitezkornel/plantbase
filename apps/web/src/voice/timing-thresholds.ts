export type TimingTone = 'good' | 'warn' | 'bad';

export const GOOD_BELOW_MS = 800;
export const BAD_ABOVE_MS = 1500;

/** green < 800 ms, red > 1500 ms, amber in between. */
export function timingTone(ms: number): TimingTone {
  if (ms < GOOD_BELOW_MS) {
    return 'good';
  }
  return ms > BAD_ABOVE_MS ? 'bad' : 'warn';
}
