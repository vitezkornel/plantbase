#!/usr/bin/env node
// product-sync — 1. lépés: egy Shopify-feed (`/products.json`) teljes letöltése
// és normalizálása. Nincs függősége (Node 18+ beépített fetch).
//
// Használat:
//   node fetch-feed.mjs <source> [--match <regex>] [--out <fájl>]
//
//   <source>        tropicalhome.hu | thesill.com
//   --match <regex> kis/nagybetű-független előszűrés a címre, típusra,
//                   címkékre és handle-re (pl. "ficus|fikusz")
//   --out <fájl>    kimenet (alapértelmezés: tmp/product-sync/<source>.json)
//
// Az árak forintban kerülnek a kimenetbe: a USD-feedet a fix USD_HUF_RATE
// árfolyammal váltjuk át (lásd lent), a HUF-feedet változatlanul hagyjuk.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Fix árfolyam a USD-feedekhez. Frissítsd, ha elavult — a riport kiírja.
export const USD_HUF_RATE = 350;
export const USD_HUF_RATE_DATE = '2026-09-26';

export const SOURCES = {
  'tropicalhome.hu': {
    baseUrl: 'https://tropicalhome.hu',
    currency: 'HUF',
  },
  'thesill.com': {
    baseUrl: 'https://www.thesill.com',
    currency: 'USD',
  },
};

const PAGE_LIMIT = 250;

// Csomag/kollekció-heurisztika: a katalógusba csak egyedi növény kerül.
// A cím/handle alapján jelöl (a "3+1" promóciós címkét szándékosan nem).
const BUNDLE_PATTERN =
  /\b(bundle|pack|kit|set|collection|assortment|trio|duo|orchard|kollekció|csomag|szett|válogatás)\b/i;

function bundleHint(product) {
  const match = `${product.title} ${product.handle.replace(/-/g, ' ')}`.match(
    BUNDLE_PATTERN,
  );
  return match ? `csomag/kollekció („${match[1]}” a címben/handle-ben)` : null;
}
const MAX_PAGES = 40;

function parseArgs(argv) {
  const [source, ...rest] = argv;
  const opts = { source, match: null, out: null };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--match') opts.match = rest[++i];
    else if (rest[i] === '--out') opts.out = rest[++i];
    else throw new Error(`Ismeretlen argumentum: ${rest[i]}`);
  }
  if (!SOURCES[source]) {
    throw new Error(
      `Ismeretlen forrás: "${source}". Támogatott: ${Object.keys(SOURCES).join(', ')}`,
    );
  }
  return opts;
}

async function fetchAllProducts(baseUrl) {
  const products = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${baseUrl}/products.json?limit=${PAGE_LIMIT}&page=${page}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'plantbase-product-sync/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
    const body = await res.json();
    if (!Array.isArray(body.products) || body.products.length === 0) break;
    products.push(...body.products);
  }
  return products;
}

function htmlToText(html) {
  return (html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toHuf(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return null;
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  // USD → HUF, 10 Ft-ra kerekítve; HUF egész forintra.
  return currency === 'USD'
    ? Math.round((value * USD_HUF_RATE) / 10) * 10
    : Math.round(value);
}

// Egy termék = egy sor: a legolcsóbb elérhető variáns (ha egyik sem elérhető,
// a legolcsóbb bármelyik). Akció: compare_at_price > price.
function pickVariant(variants) {
  const available = variants.filter((v) => v.available);
  const pool = available.length > 0 ? available : variants;
  return [...pool].sort((a, b) => Number(a.price) - Number(b.price))[0];
}

function normalize(product, source, currency) {
  const variant = pickVariant(product.variants ?? []);
  const current = variant ? Number(variant.price) : null;
  const compareAt = variant?.compare_at_price
    ? Number(variant.compare_at_price)
    : null;
  const isOnSale =
    compareAt !== null && current !== null && compareAt > current;

  return {
    source,
    handle: product.handle,
    title: product.title,
    productType: product.product_type ?? '',
    vendor: product.vendor ?? '',
    tags: (product.tags ?? []).filter((t) => !/^rs_/.test(t)),
    variantTitle: variant?.title ?? null,
    bodyText: htmlToText(product.body_html).slice(0, 1500),
    url: `${SOURCES[source].baseUrl}/products/${product.handle}`,
    currency,
    priceHuf: toHuf(isOnSale ? compareAt : current, currency),
    salePriceHuf: isOnSale ? toHuf(current, currency) : null,
    available: (product.variants ?? []).some((v) => v.available),
    bundleHint: bundleHint(product),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { baseUrl, currency } = SOURCES[opts.source];
  const raw = await fetchAllProducts(baseUrl);
  const all = raw.map((p) => normalize(p, opts.source, currency));

  const matcher = opts.match ? new RegExp(opts.match, 'i') : null;
  const items = matcher
    ? all.filter((p) =>
        matcher.test([p.title, p.productType, p.handle, ...p.tags].join(' | ')),
      )
    : all;

  const out = resolve(opts.out ?? `tmp/product-sync/${opts.source}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        source: opts.source,
        fetchedAt: new Date().toISOString(),
        currency,
        usdHufRate: currency === 'USD' ? USD_HUF_RATE : null,
        usdHufRateDate: currency === 'USD' ? USD_HUF_RATE_DATE : null,
        totalInFeed: all.length,
        match: opts.match,
        items,
      },
      null,
      2,
    ),
  );
  console.log(
    `${opts.source}: ${all.length} termék a feedben, ${items.length} a szűrés után → ${out}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
