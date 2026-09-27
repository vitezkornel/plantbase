// packages/core/src/tools/ingest-product/ingest-product-schema.ts
//
// konvenciok.md "Validáció a rendszer-határokon": the calling (admin)
// agent's input is LLM-produced and untrusted — Zod-validated before the
// write-capable ingest agent is started.

import { z } from 'zod';

export const IngestProductToolInputSchema = z.object({
  request: z
    .string()
    .min(1, 'request must not be empty')
    .max(500)
    .describe(
      'A feltöltési kérés természetes nyelven, a felhasználó szavaival (pl. „tölts be 3 fikuszt a tropicalhome-ról”).',
    ),
});

export type IngestProductToolInput = z.infer<
  typeof IngestProductToolInputSchema
>;
