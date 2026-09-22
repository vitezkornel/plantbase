// packages/core/src/tools/customer-preferences/customer-preferences-schema.ts
//
// konvenciok.md "Validáció a rendszer-határokon": ez a tool bemenete is
// `unknown`-ként érkezik a modelltől (LLM-produkálta, megbízhatatlan) —
// Zod-dal validáljuk, mielőtt a statikus ügyféllistában keresnénk.

import { z } from 'zod';

export const CustomerPreferencesInputSchema = z.object({
  name: z
    .string()
    .min(1, 'name must not be empty')
    .describe('A megnevezett ügyfél neve, akinek a preferenciáit keressük.'),
});

export type CustomerPreferencesInput = z.infer<
  typeof CustomerPreferencesInputSchema
>;
