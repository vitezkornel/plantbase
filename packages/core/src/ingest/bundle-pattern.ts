// packages/core/src/ingest/bundle-pattern.ts
//
// Shared by both ingest tools (konvenciok.md: "a közös kód eggyel kintebb
// lakik"): `scrapeProducts` flags bundle-looking feed items for the model,
// and `upsertProducts` refuses them as a deterministic backstop — a catalog
// row is one plant, so a multi-plant bundle would give the ask-agent false
// price/size/light data. Same heuristic as the dev-side product-sync skill.
// The "3+1" promo tag is deliberately not matched.

export const BUNDLE_PATTERN =
  /\b(bundle|pack|kit|set|collection|assortment|trio|duo|orchard|kollekció|csomag|szett|válogatás)\b/i;

/** Returns the matched bundle word, or null if the text looks like a single plant. */
export function bundleWord(text: string): string | null {
  return text.replace(/-/g, ' ').match(BUNDLE_PATTERN)?.[1] ?? null;
}
