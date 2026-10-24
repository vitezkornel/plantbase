import { describe, expect, it } from 'vitest';
import { createStepTimer } from './step-timing.js';

function clock(start = 0) {
  let now = start;
  return {
    now: () => now,
    set: (value: number) => {
      now = value;
    },
  };
}

describe('createStepTimer', () => {
  it('should time a step and the tool call inside it, relative to the start', async () => {
    const c = clock(1000);
    const timer = createStepTimer(c.now);
    const tools = timer.wrapTools({
      runSql: {
        execute: async () => {
          c.set(1150);
          return 'rows';
        },
      },
    });
    c.set(1120);

    await tools.runSql.execute();
    c.set(1400);
    timer.stepFinished();
    c.set(1900);
    timer.stepFinished();

    expect(timer.snapshot()).toEqual({
      totalMs: 900,
      steps: [
        {
          startMs: 0,
          endMs: 400,
          tools: [{ name: 'runSql', startMs: 120, endMs: 150 }],
        },
        { startMs: 400, endMs: 900, tools: [] },
      ],
    });
  });

  it('should show a tool call that has not finished, in a trailing unfinished step', () => {
    const c = clock(0);
    const timer = createStepTimer(c.now);
    const tools = timer.wrapTools({
      runSql: { execute: () => new Promise<never>(() => undefined) },
    });
    c.set(100);
    void tools.runSql.execute();
    c.set(20_000);

    expect(timer.snapshot()).toEqual({
      totalMs: 20_000,
      steps: [
        {
          startMs: 0,
          endMs: 20_000,
          tools: [{ name: 'runSql', startMs: 100, endMs: null }],
          unfinished: true,
        },
      ],
    });
  });

  it('should have no steps before anything happened', () => {
    const c = clock(5);
    const timer = createStepTimer(c.now);
    c.set(9);

    expect(timer.snapshot()).toEqual({ totalMs: 4, steps: [] });
  });

  it('should record the end of a tool call that throws, and rethrow', async () => {
    const c = clock(0);
    const timer = createStepTimer(c.now);
    const tools = timer.wrapTools({
      boom: {
        execute: async () => {
          c.set(30);
          throw new Error('nope');
        },
      },
    });

    await expect(tools.boom.execute()).rejects.toThrow('nope');
    timer.stepFinished();

    expect(timer.snapshot().steps[0]?.tools).toEqual([
      { name: 'boom', startMs: 0, endMs: 30 },
    ]);
  });

  it('should leave tools without an execute function untouched', () => {
    const timer = createStepTimer(clock().now);
    const wrapped = timer.wrapTools({ plain: { description: 'x' } });

    expect(wrapped.plain).toEqual({ description: 'x' });
  });
});
