// packages/core/src/ingest/upsert-products/upsert-products-tool.ts
//
// The `upsertProducts` tool: maps validated ingest rows onto the Product
// schema and writes them through packages/db's `upsertProducts` — the
// READ-WRITE Prisma connection (DATABASE_URL), never the read-only
// agent-DB pool (tools/readonly-db-client.ts). Only the ingest agent
// registers this tool; the ask-agent's toolset never includes it.
//
// Deterministic backstops, independent of the prompt:
// - a bundle-looking row (name/handle) is refused, not written;
// - the domain rule "akciós az, aminek sale_price < price" is enforced;
// - `available` becomes stock 1/0 (availability, not a quantity).

import { tool } from 'ai';
import {
  upsertProducts as defaultWriter,
  type ProductUpsertInput,
  type ProductUpsertResult,
} from 'db';
import type { ToolOutcome } from '../../tools/tool-outcome.js';
import { bundleWord } from '../bundle-pattern.js';
import {
  UpsertProductsInputSchema,
  type IngestProduct,
} from './upsert-products-schema.js';

export const UPSERT_PRODUCTS_TOOL_NAME = 'upsertProducts';

export interface UpsertProductsDeps {
  writer?: (rows: ProductUpsertInput[]) => Promise<ProductUpsertResult>;
}

export function toProductRow(
  product: IngestProduct,
  warnings: string[],
): ProductUpsertInput {
  let salePrice = product.salePriceHuf;
  if (
    salePrice !== null &&
    !(product.priceHuf !== null && salePrice < product.priceHuf)
  ) {
    warnings.push(
      `${product.source}/${product.handle}: salePriceHuf nem kisebb a priceHuf-nál → null`,
    );
    salePrice = null;
  }
  return {
    source: product.source,
    sourceHandle: product.handle,
    name: product.name,
    latinName: product.latinName,
    category: product.category,
    location: product.location,
    price: product.priceHuf,
    salePrice,
    stock: product.available ? 1 : 0,
    light: product.light,
    watering: product.watering,
    difficulty: product.difficulty,
    currentHeightCm: null,
    maxHeightCm: product.maxHeightCm,
    currentPotCm: product.currentPotCm,
    petSafe: product.petSafe,
    kidSafe: null,
    airPurifying: product.airPurifying,
    description: product.description,
  };
}

/**
 * Executes one `upsertProducts` call. Never throws — invalid input or a DB
 * error come back as `{ ok: false, error }` so the model can report it.
 */
export async function executeUpsertProducts(
  rawInput: unknown,
  deps: UpsertProductsDeps = {},
): Promise<ToolOutcome> {
  const parsed = UpsertProductsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Érvénytelen upsertProducts input: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    };
  }

  const warnings: string[] = [];
  const rejected: string[] = [];
  const rows: ProductUpsertInput[] = [];
  for (const product of parsed.data.products) {
    const word = bundleWord(`${product.name} ${product.handle}`);
    if (word) {
      rejected.push(
        `${product.source}/${product.handle}: csomag/kollekció („${word}”) — nem írtam be`,
      );
      continue;
    }
    rows.push(toProductRow(product, warnings));
  }

  if (rows.length === 0) {
    return {
      ok: true,
      data: { inserted: [], updated: [], rejected, warnings },
    };
  }

  try {
    const result = await (deps.writer ?? defaultWriter)(rows);
    return { ok: true, data: { ...result, rejected, warnings } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Adatbázis-hiba az upsert közben: ${message}` };
  }
}

export const upsertProductsTool = tool({
  description:
    'Beírja vagy frissíti a megadott feed-termékeket a products táblába a (source, handle) kulcs alapján. ' +
    'Csak egyedi élő növényt adj át, a scrapeProducts adataiból, a rendszerprompt mezőszabályai szerint. ' +
    'Visszaadja a beszúrt és frissített handle-öket, a visszautasított csomagokat és a figyelmeztetéseket.',
  inputSchema: UpsertProductsInputSchema,
  execute: (input) => executeUpsertProducts(input),
});
