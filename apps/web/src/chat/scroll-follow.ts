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

// How far from the bottom still counts as "exactly at the bottom" when the
// view moved up: shrinking content clamps scrollTop to the bottom (0 px,
// maybe a fractional pixel off), a reader's scroll leaves it.
const AT_BOTTOM_PX = 2;

/**
 * One scroll position reading. Only the reader scrolling up stops the
 * following — any step up that leaves the very bottom, however small,
 * since smooth wheel and touch scrolling move a few px per frame. Growing
 * content never lowers scrollTop, so a reading taken while a large chunk
 * arrives cannot switch it off by itself; content that shrinks while the
 * view stays at the bottom keeps it on. Coming back near the bottom
 * (within `NEAR_BOTTOM_PX`) resumes it.
 */
export function nextFollowState(
  prev: FollowState,
  metrics: ScrollMetrics,
): FollowState {
  const scrolledUp = metrics.scrollTop < prev.lastScrollTop;
  const leftTheBottom = !isNearBottom(metrics, AT_BOTTOM_PX);
  const isFollowing =
    scrolledUp && leftTheBottom
      ? false
      : isNearBottom(metrics) || prev.isFollowing;
  return { isFollowing, lastScrollTop: metrics.scrollTop };
}

/** The ↓ button shows when the reader has left the bottom and there is something to return to. */
export function shouldShowJumpButton(
  isFollowing: boolean,
  messageCount: number,
): boolean {
  return !isFollowing && messageCount > 0;
}
