// The chat's scroll decisions, kept free of React and the DOM so they can
// be unit-tested: the browser's real scrolling is out of reach of the SSR
// tests (and jsdom computes no layout).

export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface FollowState {
  isFollowing: boolean;
  lastScrollTop: number;
}

// Tolerance so a tiny nudge or a fractional scrollTop (zoom, HiDPI) still
// counts as "at the bottom".
export const NEAR_BOTTOM_PX = 48;

/** True when the bottom of the view is within `threshold` px of the content's bottom. */
export function isNearBottom(
  metrics: ScrollMetrics,
  threshold = NEAR_BOTTOM_PX,
): boolean {
  const { scrollTop, scrollHeight, clientHeight } = metrics;
  return scrollHeight - clientHeight - scrollTop <= threshold;
}

/**
 * One scroll event. Only the reader scrolling up stops the following:
 * growing content never lowers scrollTop, so a scroll event that fires
 * while a large chunk arrives cannot switch it off by itself; and content
 * that shrinks while the view stays at the bottom keeps it on.
 */
export function nextFollowState(
  prev: FollowState,
  metrics: ScrollMetrics,
): FollowState {
  const scrolledUp = metrics.scrollTop < prev.lastScrollTop;
  return {
    isFollowing: isNearBottom(metrics) || (prev.isFollowing && !scrolledUp),
    lastScrollTop: metrics.scrollTop,
  };
}
