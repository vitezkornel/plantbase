// packages/core/src/tools/list-categories/list-categories-schema.ts
//
// konvenciok.md "Validáció a rendszer-határokon": the `listCategories`
// tool takes no parameters, but its (LLM-produced) input still arrives as
// `unknown` — validate it's at least object-shaped before touching
// anything else, same boundary discipline as run-sql-schema.ts.

import { z } from 'zod';

export const ListCategoriesInputSchema = z.object({});

export type ListCategoriesInput = z.infer<typeof ListCategoriesInputSchema>;
