import { describe, expect, it } from 'vitest';
import {
  isNearBottom,
  NEAR_BOTTOM_PX,
  nextFollowState,
  shouldShowJumpButton,
  type ScrollMetrics,
} from './scroll-follow';

// A 1000 px tall page in a 600 px tall window: the bottom is scrollTop 400.
function at(scrollTop: number, scrollHeight = 1000): ScrollMetrics {
  return { scrollTop, scrollHeight, clientHeight: 600 };
}

describe('isNearBottom', () => {
  it('should be true when the view is exactly at the bottom', () => {
    expect(isNearBottom(at(400))).toBe(true);
  });

  it('should be true when the view is within the tolerance', () => {
    expect(isNearBottom(at(400 - (NEAR_BOTTOM_PX - 1)))).toBe(true);
  });

  it('should be true when the view is exactly at the tolerance', () => {
    expect(isNearBottom(at(400 - NEAR_BOTTOM_PX))).toBe(true);
  });

  it('should be false when the view is one pixel beyond the tolerance', () => {
    expect(isNearBottom(at(400 - NEAR_BOTTOM_PX - 1))).toBe(false);
  });

  it('should be true when the content is shorter than the window', () => {
    expect(
      isNearBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 600 }),
    ).toBe(true);
  });

  it('should be true when a zoomed page reports a fractional scrollTop at the bottom', () => {
    expect(isNearBottom(at(399.6))).toBe(true);
  });

  it('should use the given threshold when one is passed', () => {
    expect(isNearBottom(at(390), 5)).toBe(false);
    expect(isNearBottom(at(396), 5)).toBe(true);
  });
});

describe('nextFollowState', () => {
  const following = { isFollowing: true, lastScrollTop: 400 };
  const reading = { isFollowing: false, lastScrollTop: 100 };

  it('should keep following when the content grows below a view that did not move', () => {
    expect(nextFollowState(following, at(400, 1600)).isFollowing).toBe(true);
  });

  it('should keep following when the view moves down but not to the bottom', () => {
    expect(nextFollowState(following, at(500, 1600)).isFollowing).toBe(true);
  });

  it('should stop following when the reader scrolls up beyond the tolerance', () => {
    expect(nextFollowState(following, at(200)).isFollowing).toBe(false);
  });

  it('should stop following when the reader scrolls up even within the tolerance', () => {
    // Smooth wheel and touch scrolling move a few px per frame: each step
    // must count, or the next streamed chunk snaps the view back down.
    expect(nextFollowState(following, at(380)).isFollowing).toBe(false);
  });

  it('should follow again when a reader who left the bottom scrolls down into the tolerance', () => {
    expect(nextFollowState(reading, at(380)).isFollowing).toBe(true);
  });

  it('should keep following when shrinking content pulls the view up but it stays at the bottom', () => {
    // The "Gondolkodom…" row or an error disappears: the page loses 40 px and
    // the browser clamps scrollTop from 400 to 360 — still the bottom.
    expect(nextFollowState(following, at(360, 960)).isFollowing).toBe(true);
  });

  it('should stay put when a reader who left the bottom scrolls down but not to it', () => {
    expect(nextFollowState(reading, at(250)).isFollowing).toBe(false);
  });

  it('should follow again when a reader who left the bottom scrolls back to it', () => {
    expect(nextFollowState(reading, at(400)).isFollowing).toBe(true);
  });

  it('should remember the new scroll position when any scroll event arrives', () => {
    expect(nextFollowState(reading, at(250)).lastScrollTop).toBe(250);
    expect(nextFollowState(following, at(360, 960)).lastScrollTop).toBe(360);
  });
});

describe('shouldShowJumpButton', () => {
  it('should hide the button when the reader is following', () => {
    expect(shouldShowJumpButton(true, 3)).toBe(false);
  });

  it('should show the button when the reader has left the bottom of a conversation', () => {
    expect(shouldShowJumpButton(false, 3)).toBe(true);
  });

  it('should hide the button when there are no messages yet', () => {
    expect(shouldShowJumpButton(false, 0)).toBe(false);
  });
});
