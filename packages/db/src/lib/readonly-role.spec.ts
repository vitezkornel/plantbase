// packages/db/src/lib/readonly-role.spec.ts
//
// Integration test for the `plantbase_readonly` Postgres role (task A4,
// packages/db/sql/create-readonly-role.sql). This is the automated backing
// for the project's core security guarantee (docs/architektura.md #2:
// "Két DB-kapcsolat, két jog") — the agent's future `runSql` tool runs on
// this READ-ONLY connection and must only ever be able to SELECT.
//
// Uses the raw `pg` driver (not Prisma) because that's what `runSql` will
// actually use in Part B (see sql/create-readonly-role.sql's own header
// comment: "This role connects directly via the `pg` driver — it is NEVER
// used through Prisma"), so this test exercises the real code path.
//
// Requires the live compose Postgres container (`plantbase-postgres`) to be
// running and DATABASE_URL_READONLY to be set — this is an integration
// test, not a unit test, by design.

import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

// Same env-loading pattern as ../../prisma.config.ts: the root .env lives
// two levels up from this package, and Nx runs the `test` target with
// cwd = packages/db, so this resolves the same way `prisma.config.ts` does.
loadEnv({ path: resolve(process.cwd(), '../../.env') });

const connectionString = process.env['DATABASE_URL_READONLY'];

if (!connectionString) {
  throw new Error(
    'DATABASE_URL_READONLY is not set — copy .env.example to .env at the repo root and fill in the Postgres values (see packages/db/sql/create-readonly-role.sql).',
  );
}

describe('plantbase_readonly role', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('can SELECT from products', async () => {
    const result = await client.query('SELECT count(*) FROM products');

    expect(result.rows).toHaveLength(1);
    expect(Number(result.rows[0].count)).toBeGreaterThan(0);
  });

  // The three tests below attempt writes that are *expected* to fail with
  // 42501 (insufficient_privilege). But the whole point of this test is to
  // catch the case where that expectation is wrong and the readonly role
  // unexpectedly has write access — so each attempt is wrapped in an
  // explicit BEGIN/ROLLBACK on this same client (transaction state is
  // per-connection, so it must run on the same `client`, not a separate
  // pool connection) and scoped to a WHERE predicate that can't match any
  // real seeded row. That way even a would-be-successful write is (a) never
  // committed and (b), belt-and-suspenders, never targets real data in the
  // first place.

  it('cannot INSERT into products', async () => {
    await client.query('BEGIN');
    try {
      await expect(
        client.query(
          "INSERT INTO products (name) VALUES ('__readonly-role-spec-sentinel-should-not-insert__')",
        ),
      ).rejects.toMatchObject({ code: '42501' }); // insufficient_privilege
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('cannot UPDATE products', async () => {
    await client.query('BEGIN');
    try {
      await expect(
        // id = -1 can never match a seeded row (autoincrement ids are positive).
        client.query("UPDATE products SET name = 'hacked' WHERE id = -1"),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('cannot DELETE from products', async () => {
    await client.query('BEGIN');
    try {
      await expect(
        // id = -1 can never match a seeded row (autoincrement ids are positive).
        client.query('DELETE FROM products WHERE id = -1'),
      ).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
