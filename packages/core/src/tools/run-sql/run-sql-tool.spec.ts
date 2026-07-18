// packages/core/src/tools/run-sql/run-sql-tool.spec.ts
//
// konvenciok.md: "A teszt a tesztelt kód mellett lakik" — every test for
// this ONE tool (schema, guard, client, dispatch) lives in this one file,
// beside the code it tests.
//
// Two kinds of tests here, deliberately:
//  - Guard/validation unit tests (fast, no DB) that also assert the DB is
//    NEVER reached for a rejected query — this is the shape of proof the
//    task brief asks for: a rejected query must not even attempt to run.
//  - Real integration tests against the live `DATABASE_URL_READONLY`
//    connection (require the compose Postgres container to be up) that
//    prove BOTH layers of the security story hold: (a) a valid SELECT
//    actually executes and returns real seeded rows, and (b) even a query
//    that bypasses this file's own application-level guard (called
//    directly against the readonly client, simulating a guard bug) is
//    still rejected by the `plantbase_readonly` Postgres role itself —
//    mirroring packages/db/src/lib/readonly-role.spec.ts's own proof, but
//    exercised here through this package's own client, not by importing
//    packages/db.

import { afterAll, describe, expect, it, vi } from 'vitest';
import { guardReadOnlySql } from './sql-guard.js';

describe('guardReadOnlySql', () => {
  it('allows a plain SELECT', () => {
    expect(guardReadOnlySql('SELECT id, name FROM products LIMIT 10')).toEqual({
      ok: true,
    });
  });

  it('allows a SELECT built on a non-mutating WITH/CTE', () => {
    expect(
      guardReadOnlySql(
        'WITH cheap AS (SELECT * FROM products WHERE price < 5000) SELECT * FROM cheap LIMIT 10',
      ),
    ).toEqual({ ok: true });
  });

  it('rejects a bare DELETE', () => {
    const result = guardReadOnlySql('DELETE FROM products WHERE id = 1');
    expect(result.ok).toBe(false);
  });

  it('rejects a bare UPDATE', () => {
    const result = guardReadOnlySql("UPDATE products SET name = 'x'");
    expect(result.ok).toBe(false);
  });

  it('rejects a bare DROP TABLE', () => {
    const result = guardReadOnlySql('DROP TABLE products');
    expect(result.ok).toBe(false);
  });

  it('rejects stacked statements via semicolon', () => {
    const result = guardReadOnlySql('SELECT 1; DROP TABLE products;');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/statement/i);
    }
  });

  it('rejects the data-modifying CTE bypass (WITH ... DELETE ... RETURNING ... SELECT)', () => {
    // The exact real Postgres bypass named in the task brief: syntactically
    // one statement, starts SELECT/WITH-shaped, but a DELETE runs inside
    // the CTE body. A "starts with SELECT" check alone would miss this.
    const result = guardReadOnlySql(
      'WITH deleted AS (DELETE FROM products RETURNING *) SELECT * FROM deleted;',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/DELETE/i);
    }
  });

  it('rejects a SELECT ... INTO (creates a table, a DDL-equivalent bypass)', () => {
    const result = guardReadOnlySql('SELECT * INTO new_table FROM products');
    expect(result.ok).toBe(false);
  });

  it('rejects a statement that does not start with SELECT or WITH', () => {
    const result = guardReadOnlySql('EXPLAIN SELECT * FROM products');
    expect(result.ok).toBe(false);
  });

  it('rejects an empty/whitespace-only string', () => {
    expect(guardReadOnlySql('   ').ok).toBe(false);
  });
});

describe('executeRunSql — input validation and guard (DB never reached on rejection)', () => {
  it('rejects non-string sql input via Zod without touching the DB client module', async () => {
    vi.resetModules();
    const dbClientSpy = vi.fn();
    vi.doMock('../readonly-db-client.js', () => ({
      runReadonlyQuery: dbClientSpy,
    }));

    const { executeRunSql } = await import('./run-sql-tool.js');
    const outcome = await executeRunSql({ sql: 12345 });

    expect(outcome.ok).toBe(false);
    expect(dbClientSpy).not.toHaveBeenCalled();
    vi.doUnmock('../readonly-db-client.js');
    vi.resetModules();
  });

  it('rejects an empty sql string via Zod without touching the DB', async () => {
    vi.resetModules();
    const dbClientSpy = vi.fn();
    vi.doMock('../readonly-db-client.js', () => ({
      runReadonlyQuery: dbClientSpy,
    }));

    const { executeRunSql } = await import('./run-sql-tool.js');
    const outcome = await executeRunSql({ sql: '' });

    expect(outcome.ok).toBe(false);
    expect(dbClientSpy).not.toHaveBeenCalled();
    vi.doUnmock('../readonly-db-client.js');
    vi.resetModules();
  });

  it('rejects missing sql field via Zod without touching the DB', async () => {
    vi.resetModules();
    const dbClientSpy = vi.fn();
    vi.doMock('../readonly-db-client.js', () => ({
      runReadonlyQuery: dbClientSpy,
    }));

    const { executeRunSql } = await import('./run-sql-tool.js');
    const outcome = await executeRunSql({});

    expect(outcome.ok).toBe(false);
    expect(dbClientSpy).not.toHaveBeenCalled();
    vi.doUnmock('../readonly-db-client.js');
    vi.resetModules();
  });

  it('rejects a mutating statement via the guard without touching the DB', async () => {
    vi.resetModules();
    const dbClientSpy = vi.fn();
    vi.doMock('../readonly-db-client.js', () => ({
      runReadonlyQuery: dbClientSpy,
    }));

    const { executeRunSql } = await import('./run-sql-tool.js');
    const outcome = await executeRunSql({
      sql: 'DELETE FROM products WHERE id = 1',
    });

    expect(outcome.ok).toBe(false);
    expect(dbClientSpy).not.toHaveBeenCalled();
    vi.doUnmock('../readonly-db-client.js');
    vi.resetModules();
  });

  it('rejects the CTE-write-bypass via the guard without touching the DB', async () => {
    vi.resetModules();
    const dbClientSpy = vi.fn();
    vi.doMock('../readonly-db-client.js', () => ({
      runReadonlyQuery: dbClientSpy,
    }));

    const { executeRunSql } = await import('./run-sql-tool.js');
    const outcome = await executeRunSql({
      sql: 'WITH deleted AS (DELETE FROM products RETURNING *) SELECT * FROM deleted;',
    });

    expect(outcome.ok).toBe(false);
    expect(dbClientSpy).not.toHaveBeenCalled();
    vi.doUnmock('../readonly-db-client.js');
    vi.resetModules();
  });

  it('rejects stacked statements via the guard without touching the DB', async () => {
    vi.resetModules();
    const dbClientSpy = vi.fn();
    vi.doMock('../readonly-db-client.js', () => ({
      runReadonlyQuery: dbClientSpy,
    }));

    const { executeRunSql } = await import('./run-sql-tool.js');
    const outcome = await executeRunSql({
      sql: 'SELECT 1; DROP TABLE products;',
    });

    expect(outcome.ok).toBe(false);
    expect(dbClientSpy).not.toHaveBeenCalled();
    vi.doUnmock('../readonly-db-client.js');
    vi.resetModules();
  });
});

// --- Real, live-DB integration tests -----------------------------------
// Requires the compose Postgres container (`plantbase-postgres`) up and
// DATABASE_URL_READONLY set, same precondition as
// packages/db/src/lib/readonly-role.spec.ts.

describe('runSql — live DATABASE_URL_READONLY integration', () => {
  afterAll(async () => {
    const { closeReadonlyPool } = await import('../readonly-db-client.js');
    await closeReadonlyPool();
  });

  it('executeRunSql runs a real SELECT and returns real seeded rows', async () => {
    const { executeRunSql } = await import('./run-sql-tool.js');
    const outcome = await executeRunSql({
      sql: 'SELECT count(*) AS count FROM products',
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const data = outcome.data as { rows: Array<{ count: string }> };
      expect(data.rows).toHaveLength(1);
      expect(Number(data.rows[0].count)).toBeGreaterThan(0);
    }
  });

  it('the plantbase_readonly role itself rejects a mutating query, even if called directly (guard-bypass simulation, defense in depth)', async () => {
    const { runReadonlyQuery } = await import('../readonly-db-client.js');

    // Deliberately bypasses guardReadOnlySql to prove layer (b): the DB
    // role is an independent backstop, not just "trust the guard".
    // id = -1 can never match a seeded row (autoincrement ids are positive)
    // — belt-and-suspenders even though this is expected to be rejected
    // before any row could be touched.
    await expect(
      runReadonlyQuery('DELETE FROM products WHERE id = -1'),
    ).rejects.toMatchObject({ code: '42501' }); // insufficient_privilege
  });

  it('the DB/protocol layer itself rejects a stacked statement, even if called directly (guard-bypass simulation, defense in depth)', async () => {
    const { runReadonlyQuery } = await import('../readonly-db-client.js');

    // Deliberately bypasses guardReadOnlySql's semicolon check to prove
    // the extended-query-protocol backstop documented in
    // readonly-db-client.ts: passing an empty `values` array forces the
    // extended protocol, which Postgres refuses to Parse as more than one
    // statement.
    await expect(runReadonlyQuery('SELECT 1; SELECT 2')).rejects.toThrow();
  });
});
