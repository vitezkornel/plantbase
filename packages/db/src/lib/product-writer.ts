// packages/db/src/lib/product-writer.ts
//
// The ONE read-write write path into `products` outside of seed/migrations:
// the feed-ingest agent's `upsertProducts` tool (packages/core/src/ingest)
// calls this. It lives here, in packages/db, because the READ-WRITE
// `DATABASE_URL` + Prisma belong to this lib (architektura.md #2, #6) —
// packages/core never builds its own read-write connection. The ask-agent's
// toolset never reaches this module; only the separate ingest agent does.

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/client/index.js';

export interface ProductUpsertInput {
  source: string;
  sourceHandle: string;
  name: string;
  latinName: string | null;
  category: string | null;
  location: string | null;
  price: number | null;
  salePrice: number | null;
  stock: number | null;
  light: string | null;
  watering: string | null;
  difficulty: string | null;
  currentHeightCm: number | null;
  maxHeightCm: number | null;
  currentPotCm: number | null;
  petSafe: boolean | null;
  kidSafe: boolean | null;
  airPurifying: boolean | null;
  description: string | null;
}

export interface ProductUpsertResult {
  inserted: string[];
  updated: string[];
}

// Feed-owned fields always follow the feed; the rest are fill-only (a null
// never wipes an existing value), and an existing description is kept —
// the same semantics as the dev-side product-sync skill.
const FILL_ONLY = [
  'latinName',
  'category',
  'location',
  'light',
  'watering',
  'difficulty',
  'currentHeightCm',
  'maxHeightCm',
  'currentPotCm',
  'petSafe',
  'kidSafe',
  'airPurifying',
] as const;

let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (!client) {
    const connectionString = process.env['DATABASE_URL'];
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set — copy .env.example to .env at the repo root.',
      );
    }
    // allowExitOnIdle: like readonly-db-client.ts, so a finished CLI run
    // isn't kept alive by an idle pool connection.
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString, allowExitOnIdle: true }),
    });
  }
  return client;
}

/**
 * Upserts feed products by their `(source, sourceHandle)` key in one
 * transaction. Returns which handles were inserted vs. updated.
 */
export async function upsertProducts(
  products: readonly ProductUpsertInput[],
): Promise<ProductUpsertResult> {
  const prisma = getClient();
  return prisma.$transaction(async (tx) => {
    const result: ProductUpsertResult = { inserted: [], updated: [] };
    for (const product of products) {
      const key = {
        source: product.source,
        sourceHandle: product.sourceHandle,
      };
      const existing = await tx.product.findUnique({
        where: { source_sourceHandle: key },
        select: { id: true, description: true },
      });

      if (!existing) {
        await tx.product.create({ data: product });
        result.inserted.push(product.sourceHandle);
        continue;
      }

      const fillOnly = Object.fromEntries(
        FILL_ONLY.filter((field) => product[field] !== null).map((field) => [
          field,
          product[field],
        ]),
      );
      await tx.product.update({
        where: { id: existing.id },
        data: {
          name: product.name,
          price: product.price,
          salePrice: product.salePrice,
          stock: product.stock,
          ...fillOnly,
          ...(existing.description ? {} : { description: product.description }),
        },
      });
      result.updated.push(product.sourceHandle);
    }
    return result;
  });
}

/** Closes the shared Prisma client (for CLI shutdown and tests). */
export async function disconnectProductWriter(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
