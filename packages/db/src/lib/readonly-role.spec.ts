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

  it('cannot INSERT into products', async () => {
    await expect(
      client.query(
        "INSERT INTO products (name) VALUES ('readonly-role-spec-should-not-insert')",
      ),
    ).rejects.toMatchObject({ code: '42501' }); // insufficient_privilege
  });

  it('cannot UPDATE products', async () => {
    await expect(
      client.query("UPDATE products SET name = 'hacked' WHERE id = 1"),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot DELETE from products', async () => {
    await expect(client.query('DELETE FROM products')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
