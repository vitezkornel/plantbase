import { afterEach, describe, expect, it, vi } from 'vitest';

const poolOptions = vi.hoisted(() => ({ last: undefined as unknown }));
vi.mock('pg', () => ({
  Pool: class {
    constructor(options: unknown) {
      poolOptions.last = options;
    }
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    end = vi.fn().mockResolvedValue(undefined);
  },
}));

import { closeReadonlyPool, runReadonlyQuery } from './readonly-db-client.js';

describe('readonly db pool', () => {
  afterEach(async () => {
    await closeReadonlyPool();
    vi.unstubAllEnvs();
  });

  it('should bound connecting and query time so a stalled database cannot hang a tool', async () => {
    vi.stubEnv('DATABASE_URL_READONLY', 'postgres://x:y@localhost:5432/z');

    await runReadonlyQuery('SELECT 1');

    expect(poolOptions.last).toEqual(
      expect.objectContaining({
        connectionTimeoutMillis: expect.any(Number),
        statement_timeout: expect.any(Number),
        query_timeout: expect.any(Number),
      }),
    );
  });
});
