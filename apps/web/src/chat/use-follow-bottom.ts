'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  nextFollowState,
  type FollowState,
  type ScrollMetrics,
} from './scroll-follow';

function scrollingElement(): Element {
  return document.scrollingElement ?? document.documentElement;
}

function readMetrics(): ScrollMetrics {
  const { scrollTop, scrollHeight, clientHeight } = scrollingElement();
  return { scrollTop, scrollHeight, clientHeight };
}

// Instant on purpose: a smooth scroll lags behind a streaming answer.
function jumpToBottom(): void {
  window.scrollTo({
    top: scrollingElement().scrollHeight,
    behavior: 'instant',
  });
}

/**
 * Keeps the window at the bottom while `content` (the message list) grows —
 * but only while the reader is following; scrolling up stops it, scrolling
 * back down or `scrollToBottom()` resumes it. The decisions live in
 * scroll-follow.ts; this hook only wires them to the window.
 */
export function useFollowBottom(content: unknown): {
  isFollowing: boolean;
  scrollToBottom: () => void;
} {
  const stateRef = useRef<FollowState>({
    isFollowing: true,
    lastScrollTop: 0,
  });
  const [isFollowing, setIsFollowing] = useState(true);

  useEffect(() => {
    const handleScroll = () => {
      stateRef.current = nextFollowState(stateRef.current, readMetrics());
      setIsFollowing(stateRef.current.isFollowing);
    };
    // E.g. an Android keyboard shrinking the layout (interactive-widget).
    const handleResize = () => {
      if (stateRef.current.isFollowing) {
        jumpToBottom();
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Before paint, so a new chunk never flashes below the composer.
  useLayoutEffect(() => {
    if (stateRef.current.isFollowing) {
      jumpToBottom();
    }
  }, [content]);

  const scrollToBottom = useCallback(() => {
    stateRef.current = { ...stateRef.current, isFollowing: true };
    setIsFollowing(true);
    jumpToBottom();
  }, []);

  return { isFollowing, scrollToBottom };
}
