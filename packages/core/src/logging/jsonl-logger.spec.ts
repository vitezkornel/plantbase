import { readFile, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeInteractionLog } from './jsonl-logger.js';

const entry = {
  system: 'teszt system prompt',
  messages: [],
  response: 'teszt válasz',
  usage: { inputTokens: 1, outputTokens: 1 },
  sqlCalls: [],
  escalated: false,
};

describe('writeInteractionLog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should write each of two simultaneous interactions to its own file', async () => {
    // Concurrent interactions (e.g. two apps/web requests finishing in the
    // same millisecond) must never overwrite each other's log — the clock
    // is frozen so both writes deterministically share one timestamp.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:00:00.000Z'));
    const paths = await Promise.all([
      writeInteractionLog({ ...entry, response: 'első' }),
      writeInteractionLog({ ...entry, response: 'második' }),
    ]);

    expect(new Set(paths).size).toBe(2);
    const responses = await Promise.all(
      paths.map(
        async (path) =>
          JSON.parse((await readFile(path, 'utf-8')).trim()).response,
      ),
    );
    expect(responses.sort()).toEqual(['első', 'második']);

    await Promise.all(paths.map((path) => rm(path, { force: true })));
  });
});
