// packages/core/src/ingest/scrape-products/scrape-products-tool.ts
//
// The `scrapeProducts` tool: downloads a Shopify `/products.json` feed (all
// pages), normalizes each product to one row (cheapest available variant,
// HUF prices, sale only if compare_at_price > price), applies an optional
// coarse regex pre-filter and returns a COMPACT extract — noisy marketing
// tags dropped, body text cut to a short excerpt — so a whole feed never
// lands in the model's context. Read-only: no DB access at all.

import { tool } from 'ai';
import type { ToolOutcome } from '../../tools/tool-outcome.js';
import { bundleWord } from '../bundle-pattern.js';
import {
  ScrapeProductsInputSchema,
  type FeedSource,
} from './scrape-products-schema.js';

export const SCRAPE_PRODUCTS_TOOL_NAME = 'scrapeProducts';

// Fixed USD→HUF rate for the USD feed (same as the product-sync skill).
export const USD_HUF_RATE = 350;

const FEEDS: Record<FeedSource, { baseUrl: string; currency: 'HUF' | 'USD' }> =
  {
    'tropicalhome.hu': { baseUrl: 'https://tropicalhome.hu', currency: 'HUF' },
    'thesill.com': { baseUrl: 'https://www.thesill.com', currency: 'USD' },
  };

const PAGE_LIMIT = 250;
const MAX_PAGES = 40;
const DEFAULT_LIMIT = 40;
const EXCERPT_LENGTH = 240;
const MAX_TAGS = 15;
// Merchandising/ops tags that carry no product fact.
const NOISE_TAG =
  /^(rs_|Channel:|Breadcrumb:|Has Breadcrumb|Eligible|green-tag|related:|bfcm|CA-ship|Cold Weather Fee|new-arrival|BIS\b)/i;
// Tags the field rules read — kept ahead of the rest so the MAX_TAGS cut
// never drops one (observed: ~30 thesill items lost a Sunlight tag otherwise).
const FACT_TAG =
  /light|Sunlight|Árnyéktűrő|Világos helyre|pet-friendly|Háziállat-barát|air-purifying|Légtisztító|easy-care|beginner|Kezdőknek|Mature Height|Botanical Name|Category:|Subcategory:|^\d+(?:[.,]\d+)?\s*cm$/i;

function pickTags(tags: string[]): string[] {
  const kept = tags.filter((tag) => !NOISE_TAG.test(tag));
  const facts = kept.filter((tag) => FACT_TAG.test(tag));
  return [...facts, ...kept.filter((tag) => !FACT_TAG.test(tag))].slice(
    0,
    MAX_TAGS,
  );
}

interface ShopifyVariant {
  price: string;
  compare_at_price: string | null;
  available: boolean;
}

interface ShopifyProduct {
  handle: string;
  title: string;
  product_type?: string;
  tags?: string[];
  body_html?: string | null;
  variants?: ShopifyVariant[];
}

export interface FeedItem {
  handle: string;
  url: string;
  title: string;
  productType: string;
  tags: string[];
  priceHuf: number | null;
  salePriceHuf: number | null;
  available: boolean;
  bundleHint: string | null;
  excerpt: string;
}

export interface ScrapeProductsDeps {
  fetchJson?: (url: string) => Promise<unknown>;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'plantbase-ingest/1.0' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} — ${url}`);
  }
  return response.json();
}

function htmlToText(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function toHuf(amount: number | null, currency: 'HUF' | 'USD'): number | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  return currency === 'USD'
    ? Math.round((amount * USD_HUF_RATE) / 10) * 10
    : Math.round(amount);
}

export function normalizeProduct(
  product: ShopifyProduct,
  source: FeedSource,
): FeedItem {
  const { baseUrl, currency } = FEEDS[source];
  const variants = product.variants ?? [];
  const available = variants.filter((v) => v.available);
  const pool = available.length > 0 ? available : variants;
  const variant = [...pool].sort(
    (a, b) => Number(a.price) - Number(b.price),
  )[0];

  const current = variant ? Number(variant.price) : null;
  const compareAt = variant?.compare_at_price
    ? Number(variant.compare_at_price)
    : null;
  const isOnSale =
    current !== null && compareAt !== null && compareAt > current;
  const word = bundleWord(`${product.title} ${product.handle}`);

  return {
    handle: product.handle,
    url: `${baseUrl}/products/${product.handle}`,
    title: product.title,
    productType: product.product_type ?? '',
    tags: pickTags(product.tags ?? []),
    priceHuf: toHuf(isOnSale ? compareAt : current, currency),
    salePriceHuf: isOnSale ? toHuf(current, currency) : null,
    available: variants.some((v) => v.available),
    bundleHint: word ? `csomag/kollekció („${word}”)` : null,
    excerpt: htmlToText(product.body_html).slice(0, EXCERPT_LENGTH),
  };
}

async function fetchAllProducts(
  baseUrl: string,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = (await fetchJson(
      `${baseUrl}/products.json?limit=${PAGE_LIMIT}&page=${page}`,
    )) as { products?: ShopifyProduct[] };
    if (!Array.isArray(body.products) || body.products.length === 0) break;
    products.push(...body.products);
  }
  return products;
}

/**
 * Executes one `scrapeProducts` call. Never throws — bad input, an invalid
 * regex or a network error come back as `{ ok: false, error }` for the model.
 */
export async function executeScrapeProducts(
  rawInput: unknown,
  deps: ScrapeProductsDeps = {},
): Promise<ToolOutcome> {
  const parsed = ScrapeProductsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Érvénytelen scrapeProducts input: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    };
  }
  const { source, match, limit = DEFAULT_LIMIT } = parsed.data;

  let matcher: RegExp | null = null;
  if (match) {
    try {
      matcher = new RegExp(match, 'i');
    } catch {
      return { ok: false, error: `Érvénytelen reguláris kifejezés: ${match}` };
    }
  }

  try {
    const raw = await fetchAllProducts(
      FEEDS[source].baseUrl,
      deps.fetchJson ?? defaultFetchJson,
    );
    const all = raw.map((product) => normalizeProduct(product, source));
    const matched = matcher
      ? all.filter((item) =>
          matcher.test(
            [item.title, item.productType, item.handle, ...item.tags].join(
              ' | ',
            ),
          ),
        )
      : all;

    return {
      ok: true,
      data: {
        source,
        currency: FEEDS[source].currency,
        usdHufRate: FEEDS[source].currency === 'USD' ? USD_HUF_RATE : null,
        totalInFeed: all.length,
        matched: matched.length,
        truncated: matched.length > limit,
        items: matched.slice(0, limit),
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Hiba a feed letöltésekor: ${message}` };
  }
}

export const scrapeProductsTool = tool({
  description:
    'Letölti egy webshop-feed (tropicalhome.hu vagy thesill.com) összes termékét, és tömör kivonatot ad: ' +
    'handle, cím, terméktípus, szűrt címkék, ár és akciós ár forintban, elérhetőség, csomag-gyanú (bundleHint) ' +
    'és egy rövid szövegrészlet. A match paraméterrel durván előszűrhetsz. Nem ír semmit.',
  inputSchema: ScrapeProductsInputSchema,
  execute: (input) => executeScrapeProducts(input),
});
