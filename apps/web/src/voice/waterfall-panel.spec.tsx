import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { VoiceTurn } from './voice-state';
import { WaterfallPanel } from './waterfall-panel';

const base: VoiceTurn = {
  id: 0,
  status: 'done',
  transcript: 'Milyen kaktuszaitok vannak?',
  text: 'Van néhány.',
  tools: ['runSql'],
  isEscalated: false,
  failedSentences: 0,
  server: {
    sttMs: 500,
    firstTokenMs: 1200,
    firstSentenceMs: 1700,
    totalMs: 3000,
  },
  firstSoundMs: 2000,
  error: null,
};

function html(turn: VoiceTurn): string {
  return renderToStaticMarkup(<WaterfallPanel turn={turn} />);
}

describe('WaterfallPanel', () => {
  it('should show the transcript, the answer and the tool step', () => {
    const markup = html(base);

    expect(markup).toContain('Milyen kaktuszaitok vannak?');
    expect(markup).toContain('Van néhány.');
    expect(markup).toContain('runSql');
  });

  it('should color each metric by the thresholds (green < 800, red > 1500)', () => {
    const markup = html(base);

    expect(markup).toMatch(/data-metric="stt"[^>]*data-tone="good"/);
    expect(markup).toMatch(/data-metric="first-token"[^>]*data-tone="warn"/);
    expect(markup).toMatch(/data-metric="first-sound"[^>]*data-tone="bad"/);
    expect(markup).toMatch(/data-metric="total"[^>]*data-tone="bad"/);
  });

  it('should show a dash for a metric that is not known yet', () => {
    const markup = html({
      ...base,
      status: 'answering',
      server: null,
      firstSoundMs: null,
    });

    expect(markup).toMatch(/data-metric="stt"[^>]*data-tone="pending"/);
    expect(markup).toContain('—');
  });

  it('should show the same hand-over badge as the chat when escalated', () => {
    expect(html({ ...base, isEscalated: true })).toContain(
      'Kollégának továbbítva',
    );
    expect(html(base)).not.toContain('Kollégának továbbítva');
  });

  it('should show an error in an alert', () => {
    const markup = html({
      ...base,
      status: 'error',
      error: 'Nem hallottam semmit, próbáld újra.',
    });

    expect(markup).toMatch(/role="alert"[^>]*>[^<]*Nem hallottam semmit/);
  });
});

describe('WaterfallPanel (partial turn)', () => {
  it('should show the steps reached so far and dashes for the rest', () => {
    const markup = html({
      ...base,
      status: 'answering',
      server: { sttMs: 900, firstTokenMs: 3900, firstSentenceMs: null, totalMs: null },
      firstSoundMs: null,
    });

    expect(markup).toContain('900 ms');
    expect(markup).toContain('3900 ms');
    expect(markup).toContain('—');
  });

  it('should say how many sentences could not be read aloud', () => {
    expect(html({ ...base, failedSentences: 2 })).toContain(
      '2 mondatot nem sikerült felolvasni',
    );
  });
});
