import { describe, expect, it } from 'vitest';
import {
  initialLiveState,
  liveReducer,
  MAX_LOG_LINES,
  type LiveState,
} from './live-state';

const apply = (
  state: LiveState,
  ...actions: Parameters<typeof liveReducer>[1][]
) => actions.reduce(liveReducer, state);

describe('liveReducer', () => {
  it('should walk through the connection states', () => {
    let state = apply(initialLiveState, { type: 'connecting' });
    expect(state.status).toBe('connecting');

    state = apply(state, {
      type: 'connected',
      model: 'gpt-realtime-2.1',
      demoOrders: true,
    });
    expect(state).toMatchObject({
      status: 'connected',
      model: 'gpt-realtime-2.1',
      demoOrders: true,
    });

    state = apply(state, { type: 'disconnected' });
    expect(state.status).toBe('idle');
  });

  it('should keep the transcript and log across a disconnect', () => {
    const state = apply(
      initialLiveState,
      { type: 'turn', turn: { role: 'user', text: 'szia', approximate: true } },
      { type: 'log', kind: 'info', text: 'x' },
      { type: 'disconnected' },
    );

    expect(state.turns).toHaveLength(1);
    expect(state.lines).toHaveLength(1);
  });

  it('should record a failure with its message', () => {
    const state = apply(initialLiveState, {
      type: 'failed',
      message: 'Nincs mikrofon.',
    });

    expect(state).toMatchObject({ status: 'error', error: 'Nincs mikrofon.' });
  });

  it('should number log lines and carry the demo flag', () => {
    const state = apply(
      initialLiveState,
      { type: 'log', kind: 'tool', text: 'a' },
      { type: 'log', kind: 'tool', text: 'b', demo: true },
    );

    expect(state.lines.map((l) => [l.id, l.demo])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('should cap the log length', () => {
    let state = initialLiveState;
    for (let i = 0; i < MAX_LOG_LINES + 25; i += 1) {
      state = apply(state, { type: 'log', kind: 'info', text: String(i) });
    }

    expect(state.lines).toHaveLength(MAX_LOG_LINES);
    expect(state.lines.at(-1)?.text).toBe(String(MAX_LOG_LINES + 24));
  });

  it('should show the escalation badge until the next answer', () => {
    let state = apply(initialLiveState, { type: 'escalated' });
    expect(state.escalated).toBe(true);

    state = apply(state, { type: 'new-answer' });
    expect(state.escalated).toBe(false);
  });

  it('should keep the last silence measurement', () => {
    const measurement = { sinceSpeechStopMs: 900, sinceToolMs: null };

    expect(
      apply(initialLiveState, { type: 'silence', measurement }).lastSilence,
    ).toEqual(measurement);
  });
});
