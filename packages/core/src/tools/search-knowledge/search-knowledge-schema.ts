// packages/core/src/tools/search-knowledge/search-knowledge-schema.ts
//
// konvenciok.md "Validáció a rendszer-határokon": this tool's input arrives
// as `unknown` from the Anthropic SDK (LLM-produced, untrusted) — Zod
// validate before it goes anywhere near HyDE/embed/rerank/DB.

import { z } from 'zod';

export const SearchKnowledgeInputSchema = z.object({
  query: z.string().min(1, 'query must not be empty'),
});

export type SearchKnowledgeInput = z.infer<typeof SearchKnowledgeInputSchema>;
