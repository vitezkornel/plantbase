// packages/core/src/tools/run-sql/run-sql-tool.ts
//
// The `runSql` tool: what the agent-loop registers and dispatches to when
// the model asks for it (FR2). Ties together this directory's three
// pieces — the Zod input schema (run-sql-schema.ts), the SELECT-only guard
// (sql-guard.ts), and the read-only `pg` client (readonly-db-client.ts) —
// plus the Anthropic-facing tool definition the model sees. Everything
// this ONE tool needs lives in this ONE directory (konvenciok.md: "egy
// fogalom = egy könyvtár, benne MINDEN hozzávalója").

import type { AgentTool, ToolOutcome } from '../tool-outcome.js';
import { runReadonlyQuery } from './readonly-db-client.js';
import { RunSqlInputSchema } from './run-sql-schema.js';
import { guardReadOnlySql } from './sql-guard.js';

export const RUN_SQL_TOOL_NAME = 'runSql';

/**
 * Executes one `runSql` tool call: validates the (untrusted, LLM-produced)
 * input, runs it through the read-only/single-statement guard, then runs
 * the query. Never throws — every failure mode (bad input, guard
 * rejection, DB error) comes back as `{ ok: false, error }` so the
 * agent-loop can feed it to the model as a `tool_result` and let the model
 * explain itself, instead of crashing the request.
 */
export async function executeRunSql(rawInput: unknown): Promise<ToolOutcome> {
  const parsed = RunSqlInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Érvénytelen runSql input: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    };
  }

  const guardResult = guardReadOnlySql(parsed.data.sql);
  if (!guardResult.ok) {
    return { ok: false, error: guardResult.error };
  }

  try {
    const result = await runReadonlyQuery(parsed.data.sql);
    return { ok: true, data: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Adatbázis-hiba a lekérdezés futtatásakor: ${message}`,
    };
  }
}

export const runSqlTool: AgentTool = {
  definition: {
    name: RUN_SQL_TOOL_NAME,
    description:
      'Read-only SQL SELECT lekérdezést futtat a Plantbase katalógus products táblája ' +
      'felett, és visszaadja a sorokat. CSAK egyetlen SELECT (vagy SELECT-re vezető WITH) ' +
      'statement engedélyezett — INSERT/UPDATE/DELETE/DDL és több, pontosvesszővel ' +
      'elválasztott statement el lesz utasítva. A generált SQL-t mindig ezzel a toollal ' +
      'futtasd le, ne csak írd ki szövegként.',
    input_schema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description:
            'Egyetlen, read-only SELECT (vagy SELECT-re vezető WITH) statement, ami a ' +
            'products táblát kérdezi le. Mindig tartalmazzon LIMIT-et.',
        },
      },
      required: ['sql'],
    },
  },
  execute: executeRunSql,
};
