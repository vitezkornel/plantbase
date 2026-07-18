// packages/core/src/tools/list-categories/list-categories-tool.ts
//
// The `listCategories` tool: a second, simpler sibling to `runSql`
// (tools/run-sql/). Where `runSql` runs LLM-generated SQL through a guard,
// `listCategories` runs one fixed, hardcoded query — no guard needed,
// since the model never supplies SQL text for this tool. Everything this
// ONE tool needs lives in this ONE directory (konvenciok.md: "egy fogalom
// = egy könyvtár, benne MINDEN hozzávalója"); the read-only `pg` client is
// shared with `runSql` from one level up (tools/readonly-db-client.ts).

import type { AgentTool, ToolOutcome } from '../tool-outcome.js';
import { runReadonlyQuery } from '../readonly-db-client.js';
import { ListCategoriesInputSchema } from './list-categories-schema.js';

export const LIST_CATEGORIES_TOOL_NAME = 'listCategories';

const LIST_CATEGORIES_SQL = 'SELECT DISTINCT category FROM products';

/**
 * Executes one `listCategories` tool call: validates the (untrusted,
 * LLM-produced) input, then runs the fixed distinct-category query.
 * Never throws — mirrors run-sql-tool.ts's `{ ok: false, error }` outcome
 * shape so the agent-loop can feed failures back to the model as a normal
 * `tool_result`.
 */
export async function executeListCategories(
  rawInput: unknown,
): Promise<ToolOutcome> {
  const parsed = ListCategoriesInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Érvénytelen listCategories input: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    };
  }

  try {
    const result = await runReadonlyQuery(LIST_CATEGORIES_SQL);
    return { ok: true, data: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Adatbázis-hiba a kategóriák lekérdezésekor: ${message}`,
    };
  }
}

export const listCategoriesTool: AgentTool = {
  definition: {
    name: LIST_CATEGORIES_TOOL_NAME,
    description:
      'Visszaadja a Plantbase katalógusban ténylegesen előforduló egyedi kategóriákat ' +
      '(products.category DISTINCT értékei). Nincs bemeneti paramétere. Ezt hívd, ha a ' +
      'felhasználó a katalógusban elérhető kategóriákra/típusokra kérdez rá (pl. "milyen ' +
      'kategóriák vannak?"), ahelyett hogy erre egyedi SQL-t írnál a runSql toollal.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  execute: executeListCategories,
};
