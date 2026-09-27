// LIVE integration test against the compose Postgres (read-write
// DATABASE_URL), like readonly-role.spec.ts — needs the container running
// and migrated. Uses its own `source` value and cleans up after itself.
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  disconnectProductWriter,
  upsertProducts,
  type ProductUpsertInput,
} from './product-writer.js';

loadEnv({ path: resolve(process.cwd(), '../../.env') });

const SOURCE = 'test.product-writer.local';

const base: ProductUpsertInput = {
  source: SOURCE,
  sourceHandle: 'test-ficus',
  name: 'Teszt fikusz',
  latinName: 'Ficus testus',
  category: 'szobanövény',
  location: 'beltéri',
  price: 5000,
  salePrice: null,
  stock: 1,
  light: 'erős',
  watering: null,
  difficulty: null,
  currentHeightCm: null,
  maxHeightCm: null,
  currentPotCm: 12,
  petSafe: null,
  kidSafe: null,
  airPurifying: true,
  description: 'Első leírás.',
};

describe('upsertProducts (live DB)', () => {
  const admin = new Client({ connectionString: process.env['DATABASE_URL'] });

  const cleanup = () =>
    admin.query('DELETE FROM products WHERE source = $1', [SOURCE]);

  beforeAll(async () => {
    await admin.connect();
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await admin.end();
    await disconnectProductWriter();
  });

  it('should insert a new product, then update it by (source, sourceHandle) without duplicating', async () => {
    expect(await upsertProducts([base])).toEqual({
      inserted: ['test-ficus'],
      updated: [],
    });

    const second = await upsertProducts([
      {
        ...base,
        price: 4500,
        salePrice: 3900,
        stock: 0,
        light: null,
        description: 'Új leírás.',
      },
    ]);
    expect(second).toEqual({ inserted: [], updated: ['test-ficus'] });

    const { rows } = await admin.query(
      'SELECT price, sale_price, stock, light, description FROM products WHERE source = $1',
      [SOURCE],
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].price)).toBe(4500);
    expect(Number(rows[0].sale_price)).toBe(3900);
    expect(rows[0].stock).toBe(0);
    // fill-only: a null does not wipe the existing value
    expect(rows[0].light).toBe('erős');
    // an existing description is kept
    expect(rows[0].description).toBe('Első leírás.');
  });
});
