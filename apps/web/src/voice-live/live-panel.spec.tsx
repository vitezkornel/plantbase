import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LivePanel } from './live-panel';

describe('LivePanel', () => {
  const markup = renderToStaticMarkup(<LivePanel />);

  it('should offer connect and a clearly visible disconnect button', () => {
    expect(markup).toContain('Kapcsolódás');
    expect(markup).toContain('Bontás');
  });

  it('should disable the disconnect button while idle', () => {
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>\s*Bontás/);
  });

  it('should recommend headphones because of echo-induced false barge-in', () => {
    expect(markup).toContain('Fülhallgató ajánlott');
    expect(markup).toContain('barge-in');
  });

  it('should offer the two VAD modes and the filler switch', () => {
    expect(markup).toContain('server_vad');
    expect(markup).toContain('semantic_vad');
    expect(markup).toContain('Filler');
  });

  it('should not show the escalation badge or the DEMO label at first', () => {
    expect(markup).not.toContain('Kollégának továbbítva');
    expect(markup).not.toContain('DEMO');
  });

  it('should show the two silence counters', () => {
    expect(markup).toContain('Csend a beszéd végétől');
    expect(markup).toContain('Csend a tool-hívástól');
  });
});
