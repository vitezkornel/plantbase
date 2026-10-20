import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VoicePanel } from './voice-panel';

describe('VoicePanel', () => {
  it('should render the hold-to-talk button and no turns at first', () => {
    const markup = renderToStaticMarkup(
      <VoicePanel escalatePrefix="[ESCALATE] " />,
    );

    expect(markup).toContain('Tartsd nyomva a beszédhez');
    expect(markup).not.toContain('aria-label="Fordulat"');
  });

  it('should not disable the button before the browser support is known', () => {
    const markup = renderToStaticMarkup(
      <VoicePanel escalatePrefix="[ESCALATE] " />,
    );

    expect(markup).not.toMatch(/<button[^>]*disabled/);
  });
});
