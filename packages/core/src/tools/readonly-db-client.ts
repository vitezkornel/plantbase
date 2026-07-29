// packages/core/src/tools/readonly-db-client.ts
//
// architektura.md #2: "Az agent runSql-je READ-ONLY kapcsolaton fut
// (DATABASE_URL_READONLY), csak SELECT. ... Az agent NEM Prismán kérdez."
// Raw `pg` client against the `plantbase_readonly` role — never Prisma,
// never `packages/db` (that package stays decoupled from `packages/core`;
// `DATABASE_URL_READONLY` is just an env var both happen to read
// independently — see packages/db/src/lib/readonly-role.spec.ts, which
// proves this exact role/connection is genuinely SELECT-only and is the
// pattern this module follows, without importing that package's code).
//
// Lives one level above any specific tool (konvenciok.md: "a közös kód
// eggyel kintebb lakik") because both `run-sql/` and `list-categories/`
// share this one read-only connection/pool — it isn't specific to either.

import { Pool } from 'pg';
import '../config/env.js';

let pool: Pool | undefined;

function getPool(): Pool {
  if (pool) {
    return pool;
  }

  const connectionString = process.env['DATABASE_URL_READONLY'];
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL_READONLY is not set — copy .env.example to .env at the repo root (see packages/db/sql/create-readonly-role.sql).',
    );
  }

  // allowExitOnIdle: without it, node-postgres's default idleTimeoutMillis
  // (10s) keeps the event loop alive for ~10s after every runSql call,
  // because Fázis 2 deliberately removed a forced process.exit(0) from the
  // CLI (see apps/cli/src/commands/ask-command.ts) so Node exits naturally
  // once the event loop drains. This lets the process exit promptly once
  // connections go idle, without closing the pool mid-session — the pool
  // is still reused across multiple questions within one interactive run.
  pool = new Pool({ connectionString, allowExitOnIdle: true });
  return pool;
}

export interface ReadonlyQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Runs `sql` against the read-only connection and returns its rows.
 *
 * `values` defaults to an empty array, which forces node-postgres's
 * EXTENDED query protocol (Parse/Bind/Execute) instead of the simple query
 * protocol used when `query()` is called with text alone. For
 * guard-approved, LLM-produced SQL (run-sql/sql-guard.ts) this is
 * deliberate defense-in-depth beyond the guard's own semicolon check:
 * Postgres's extended protocol only ever parses a single statement per
 * Parse message and raises a syntax error ("cannot insert multiple
 * commands into a prepared statement") if the text contains more than
 * one — so even a guard bug that let a stacked statement through would
 * still be rejected here, at the protocol layer, before a second command
 * could ever run.
 *
 * Callers with a FIXED sql string and real bind parameters (e.g.
 * search-knowledge's vector similarity query) pass `values` explicitly —
 * this is the intended, safe use of parameterization, not a relaxation of
 * the defense above (it still goes through the same extended protocol).
 */
export async function runReadonlyQuery(
  sql: string,
  values: unknown[] = [],
): Promise<ReadonlyQueryResult> {
  const client = getPool();
  const result = await client.query(sql, values);
  return {
    rows: result.rows,
    rowCount: result.rowCount ?? result.rows.length,
  };
}

/** Closes the pool. Tests use this to avoid leaving open DB handles. */
export async function closeReadonlyPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
