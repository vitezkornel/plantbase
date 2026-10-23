import { streamAskAgent } from 'core';
import { describe, expect, it, vi } from 'vitest';
import { askSupervisor } from './supervisor-ask';

vi.mock('core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('core')>()),
  streamAskAgent: vi.fn(),
}));

describe('askSupervisor', () => {
  it('should run the ask-agent in voice-live mode with only the question', async () => {
    vi.mocked(streamAskAgent).mockReturnValue({
      text: Promise.resolve('Válasz'),
    } as unknown as ReturnType<typeof streamAskAgent>);
    const signal = new AbortController().signal;

    const answer = await askSupervisor({
      question: 'Melyik kaktusz háziállat-barát?',
      clientTranscript: 'és az pet szejf',
      signal,
    });

    expect(answer).toBe('Válasz');
    expect(streamAskAgent).toHaveBeenCalledWith(
      [{ role: 'user', content: 'Melyik kaktusz háziállat-barát?' }],
      {
        mode: 'voice-live',
        abortSignal: signal,
        clientTranscript: 'és az pet szejf',
      },
    );
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
