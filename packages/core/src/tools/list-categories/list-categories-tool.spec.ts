// packages/core/src/tools/list-categories/list-categories-tool.spec.ts
//
// konvenciok.md: "A teszt a tesztelt kód mellett lakik" — schema, tool
// definition, and dispatch tests for this ONE tool all live in this one
// file, mirroring tools/run-sql/run-sql-tool.spec.ts's shape:
//  - Mocked-DB unit tests that prove the fixed query text and error
//    handling, without touching the real database.
//  - A real integration test against the live `DATABASE_URL_READONLY`
//    connection (requires the compose Postgres container up), proving the
//    query actually runs and returns the seeded catalog's real categories.

import { afterAll, describe, expect, it, vi } from 'vitest';

describe('executeListCategories — DB dispatch and error handling (mocked)', () => {
  it('runs the fixed SELECT DISTINCT category query against the readonly connection', async () => {
    vi.resetModules();
    const dbClientSpy = vi.fn().mockResolvedValue({
      rows: [{ category: 'kaktusz' }, { category: 'pozsgás' }],
      rowCount: 2,
    });
    vi.doMock('../readonly-db-client.js', () => ({
      runReadonlyQuery: dbClientSpy,
    }));

    const { executeListCategories } = await import('./list-categories-tool.js');
    const outcome = await executeListCategories({});

    expect(dbClientSpy).toHaveBeenCalledWith(
      'SELECT DISTINCT category FROM products',
    );
    expect(outcome).toEqual({
      ok: true,
      data: { rows: [{ category: 'kaktusz' }, { category: 'pozsgás' }], rowCount: 2 },
    });

    vi.doUnmock('../readonly-db-client.js');
    vi.resetModules();
  });

  it('rejects a non-object input via Zod without touching the DB', async () => {
    vi.resetModules();
    const dbClientSpy = vi.fn();
    vi.doMock('../readonly-db-client.js', () => ({
      runReadonlyQuery: dbClientSpy,
    }));

    const { executeListCategories } = await import('./list-categories-tool.js');
    const outcome = await executeListCategories('not-an-object');

    expect(outcome.ok).toBe(false);
    expect(dbClientSpy).not.toHaveBeenCalled();

    vi.doUnmock('../readonly-db-client.js');
    vi.resetModules();
  });

  it('returns ok:false with a Hungarian error message when the DB call throws', async () => {
    vi.resetModules();
    const dbClientSpy = vi.fn().mockRejectedValue(new Error('connection lost'));
    vi.doMock('../readonly-db-client.js', () => ({
      runReadonlyQuery: dbClientSpy,
    }));

    const { executeListCategories } = await import('./list-categories-tool.js');
    const outcome = await executeListCategories({});

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toMatch(/adatbázis-hiba/i);
      expect(outcome.error).toMatch(/connection lost/);
    }

    vi.doUnmock('../readonly-db-client.js');
    vi.resetModules();
  });
});

describe('listCategoriesTool — Anthropic-facing definition', () => {
  it('declares the tool name and an empty, parameter-less input schema', async () => {
    const { listCategoriesTool, LIST_CATEGORIES_TOOL_NAME } = await import(
      './list-categories-tool.js'
    );

    expect(listCategoriesTool.definition.name).toBe(LIST_CATEGORIES_TOOL_NAME);
    expect(listCategoriesTool.definition.name).toBe('listCategories');
    expect(listCategoriesTool.definition.input_schema).toEqual({
      type: 'object',
      properties: {},
    });
  });
});

// --- Real, live-DB integration test ------------------------------------
// Requires the compose Postgres container (`plantbase-postgres`) up and
// DATABASE_URL_READONLY set, same precondition as
// tools/run-sql/run-sql-tool.spec.ts's own live integration tests.

describe('listCategories — live DATABASE_URL_READONLY integration', () => {
  afterAll(async () => {
    const { closeReadonlyPool } = await import('../readonly-db-client.js');
    await closeReadonlyPool();
  });

  it('executeListCategories returns the real distinct categories from the seeded catalog', async () => {
    const { executeListCategories } = await import('./list-categories-tool.js');
    const outcome = await executeListCategories({});

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const data = outcome.data as { rows: Array<{ category: string }> };
      const categories = data.rows.map((row) => row.category);
      expect(categories).toEqual(expect.arrayContaining(['kaktusz', 'pozsgás', 'fűszer']));
      expect(new Set(categories).size).toBe(categories.length); // DISTINCT: no duplicates
    }
  });
});
