import { streamAskAgent } from 'core';
import { describe, expect, it, vi } from 'vitest';
import { askSupervisor } from './supervisor-ask';

vi.mock('core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('core')>()),
  streamAskAgent: vi.fn(),
}));

describe('askSupervisor', () => {
  it('should run the ask-agent in voice-live mode with the question when there are no transcripts', async () => {
    vi.mocked(streamAskAgent).mockReturnValue({
      text: Promise.resolve('Válasz'),
    } as unknown as ReturnType<typeof streamAskAgent>);
    const signal = new AbortController().signal;

    const answer = await askSupervisor({
      question: 'Melyik kaktusz háziállat-barát?',
      transcripts: [],
      signal,
    });

    expect(answer).toBe('Válasz');
    expect(streamAskAgent).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Melyik kaktusz háziállat-barát?' }],
      { mode: 'voice-live', abortSignal: signal },
    );
  });

  it('should pass the transcripts as history and log the last one as the client transcript', async () => {
    vi.mocked(streamAskAgent).mockReturnValue({
      text: Promise.resolve('Válasz'),
    } as unknown as ReturnType<typeof streamAskAgent>);
    const signal = new AbortController().signal;

    await askSupervisor({
      question: 'Milyen növények jók a falra?',
      transcripts: ['Szia!', 'Milyen kaktuszaitok vannak?'],
      signal,
    });

    const [messages, options] = vi.mocked(streamAskAgent).mock.calls.at(-1) ?? [];
    expect(messages).toHaveLength(2);
    expect(messages?.[0]).toEqual({ role: 'user', content: 'Szia!' });
    expect(String(messages?.[1]?.content)).toContain('Milyen kaktuszaitok vannak?');
    expect(options).toEqual({
      mode: 'voice-live',
      abortSignal: signal,
      clientTranscript: 'Milyen kaktuszaitok vannak?',
    });
  });

  it('should omit the client transcript when there is none', async () => {
    vi.mocked(streamAskAgent).mockReturnValue({
      text: Promise.resolve('x'),
    } as unknown as ReturnType<typeof streamAskAgent>);
    const signal = new AbortController().signal;

    await askSupervisor({ question: 'k', signal });

    expect(vi.mocked(streamAskAgent).mock.calls.at(-1)?.[1]).toEqual({
      mode: 'voice-live',
      abortSignal: signal,
    });
  });
});
