import { describe, expect, it } from 'vitest';
import { nextPttPhase } from './push-to-talk-machine';

describe('nextPttPhase', () => {
  it('should start recording on the first press', () => {
    expect(nextPttPhase('idle', 'press')).toEqual({
      phase: 'recording',
      action: 'start',
    });
  });

  it('should ignore a second press while recording (key repeat, double trigger)', () => {
    expect(nextPttPhase('recording', 'press')).toEqual({
      phase: 'recording',
      action: null,
    });
  });

  it.each(['release', 'timeout'] as const)('should stop on %s', (event) => {
    expect(nextPttPhase('recording', event)).toEqual({
      phase: 'idle',
      action: 'stop',
    });
  });

  it('should discard the recording on cancel', () => {
    expect(nextPttPhase('recording', 'cancel')).toEqual({
      phase: 'idle',
      action: 'discard',
    });
  });

  it.each(['release', 'timeout', 'cancel'] as const)(
    'should ignore %s while idle',
    (event) => {
      expect(nextPttPhase('idle', event)).toEqual({
        phase: 'idle',
        action: null,
      });
    },
  );
});
