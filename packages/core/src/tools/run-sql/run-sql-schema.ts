// packages/core/src/tools/run-sql/run-sql-schema.ts
//
// konvenciok.md "Validáció a rendszer-határokon": the `runSql` tool's input
// arrives as `unknown` from the Anthropic SDK (the model produced it — an
// LLM output is untrusted, external input just like user input or an API
// response, per konvenciok.md "Biztonság"). Zod-validate it before it goes
// anywhere near the SQL guard or the database.

import { z } from 'zod';

export const RunSqlInputSchema = z.object({
  sql: z
    .string()
    .min(1, 'sql must not be empty')
    .describe(
      'Egyetlen, read-only SELECT (vagy SELECT-re vezető WITH) statement, ami a ' +
        'products táblát kérdezi le. Mindig tartalmazzon LIMIT-et.',
    ),
});

export type RunSqlInput = z.infer<typeof RunSqlInputSchema>;
