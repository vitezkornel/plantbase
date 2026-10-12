import { describe, expect, it } from 'vitest';
import { viewport } from './layout';

describe('viewport', () => {
  it('should resize the content and cover the safe areas when a mobile keyboard opens', () => {
    expect(viewport).toEqual({
      width: 'device-width',
      initialScale: 1,
      viewportFit: 'cover',
      interactiveWidget: 'resizes-content',
    });
  });
});
