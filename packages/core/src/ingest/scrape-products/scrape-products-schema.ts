// packages/core/src/ingest/scrape-products/scrape-products-schema.ts
//
// konvenciok.md "Validáció a rendszer-határokon": the model-produced input
// is untrusted — Zod-validated before any network call.

import { z } from 'zod';

export const FEED_SOURCES = ['tropicalhome.hu', 'thesill.com'] as const;
export type FeedSource = (typeof FEED_SOURCES)[number];

export const ScrapeProductsInputSchema = z.object({
  source: z
    .enum(FEED_SOURCES)
    .describe('A webshop-feed: tropicalhome.hu (HUF) vagy thesill.com (USD).'),
  match: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Opcionális, kis/nagybetű-független reguláris kifejezés durva előszűrésre (cím, típus, címkék, handle), pl. "ficus|fikusz". Legyen bő.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(60)
    .optional()
    .describe(
      'Legfeljebb ennyi terméket ad vissza (alapértelmezés 40, max 60).',
    ),
});

export type ScrapeProductsInput = z.infer<typeof ScrapeProductsInputSchema>;
