import { describe, expect, it } from 'vitest';
import { MAX_HISTORY_MESSAGE_CHARS } from './voice-request-schema';
import {
  historyFor,
  initialVoiceState,
  lastTurn,
  voiceReducer,
  type VoiceAction,
} from './voice-state';

const PREFIX = '[ESCALATE] ';

function run(...actions: VoiceAction[]) {
  return actions.reduce(voiceReducer, initialVoiceState);
}

const started: VoiceAction = { type: 'turn-started' };
const event = (
  e: Extract<VoiceAction, { type: 'event' }>['event'],
): VoiceAction => ({ type: 'event', event: e });

describe('voiceReducer', () => {
  it('should start a transcribing turn', () => {
    expect(lastTurn(run(started))?.status).toBe('transcribing');
  });

  it('should collect the transcript, text, tools and sentences of a turn', () => {
    const turn = lastTurn(
      run(
        started,
        event({ type: 'transcript', text: 'Szia', sttMs: 300 }),
        event({ type: 'tool', name: 'runSql' }),
        event({ type: 'text-delta', text: 'Van ' }),
        event({ type: 'text-delta', text: 'egy.' }),
      ),
    );

    expect(turn).toMatchObject({
      transcript: 'Szia',
      tools: ['runSql'],
      text: 'Van egy.',
      status: 'answering',
    });
  });

  it('should keep the server timing and finish on done', () => {
    const turn = lastTurn(
      run(
        started,
        event({
          type: 'timing',
          sttMs: 300,
          firstTokenMs: 900,
          firstSentenceMs: 1100,
          totalMs: 2000,
        }),
        event({ type: 'done' }),
      ),
    );

    expect(turn?.server).toEqual({
      sttMs: 300,
      firstTokenMs: 900,
      firstSentenceMs: 1100,
      totalMs: 2000,
    });
    expect(turn?.status).toBe('done');
  });

  it('should record the first sound only once', () => {
    const turn = lastTurn(
      run(
        started,
        { type: 'first-sound', ms: 700 },
        { type: 'first-sound', ms: 900 },
      ),
    );

    expect(turn?.firstSoundMs).toBe(700);
  });

  it('should mark the escalation', () => {
    expect(lastTurn(run(started, event({ type: 'escalated' })))?.isEscalated).toBe(
      true,
    );
  });

  it('should fail a turn on an error event and on a client failure', () => {
    expect(
      lastTurn(run(started, event({ type: 'error', message: 'Baj.' }))),
    ).toMatchObject({ status: 'error', error: 'Baj.' });
    expect(
      lastTurn(run(started, { type: 'failed', message: 'Nincs hálózat.' }))
        ?.error,
    ).toBe('Nincs hálózat.');
  });

  it('should abort only a turn that is still in progress', () => {
    expect(lastTurn(run(started, { type: 'aborted' }))?.status).toBe('aborted');
    expect(
      lastTurn(run(started, event({ type: 'done' }), { type: 'aborted' }))
        ?.status,
    ).toBe('done');
  });
});

describe('historyFor', () => {
  it('should return the finished turns as user/assistant pairs, keeping the escalation prefix', () => {
    const state = run(
      started,
      event({ type: 'transcript', text: 'Hol a rendelésem?', sttMs: 1 }),
      event({ type: 'escalated' }),
      event({ type: 'text-delta', text: 'Kolléga jelentkezik.' }),
      event({ type: 'done' }),
    );

    expect(historyFor(state, PREFIX)).toEqual([
      { role: 'user', content: 'Hol a rendelésem?' },
      { role: 'assistant', content: '[ESCALATE] Kolléga jelentkezik.' },
    ]);
  });

  it('should leave out aborted, failed and unfinished turns', () => {
    const state = run(
      started,
      event({ type: 'transcript', text: 'x', sttMs: 1 }),
      { type: 'aborted' },
      started,
    );

    expect(historyFor(state, PREFIX)).toEqual([]);
  });

  it('should cut a long answer so the server still accepts the history', () => {
    const state = run(
      started,
      event({ type: 'transcript', text: 'Mesélj sokat', sttMs: 1 }),
      event({ type: 'text-delta', text: 'v'.repeat(3000) }),
      event({ type: 'done' }),
    );

    const history = historyFor(state, PREFIX);

    expect(history).toHaveLength(2);
    for (const message of history) {
      expect(message.content.length).toBeLessThanOrEqual(
        MAX_HISTORY_MESSAGE_CHARS,
      );
    }
  });

  it('should keep at most the last 20 messages', () => {
    const finished = (n: number): VoiceAction[] => [
      started,
      event({ type: 'transcript', text: `k${n}`, sttMs: 1 }),
      event({ type: 'text-delta', text: `v${n}` }),
      event({ type: 'done' }),
    ];
    const state = run(
      ...Array.from({ length: 12 }, (_, n) => finished(n)).flat(),
    );

    const history = historyFor(state, PREFIX);

    expect(history).toHaveLength(20);
    expect(history[0]).toEqual({ role: 'user', content: 'k2' });
  });
});
