#!/usr/bin/env node
// product-sync — upsert a products táblába a READ-WRITE `DATABASE_URL`-en
// (ugyanaz a kapcsolat, amit a packages/db seed/migráció használ; a termék-
// agent read-only kapcsolata ide nem jó és nem is szabad, hogy jó legyen).
// A `pg` klienst a packages/db függőségei közül töltjük be.
//
// Használat:
//   node upsert.mjs --existing <candidates.json>
//       Kiírja, mely (source, handle) párok vannak már a táblában és van-e
//       description-jük — így csak az új/leírás nélküli termékekhez kell
//       leírást írni. Nem ír az adatbázisba.
//   node upsert.mjs <enriched.json> [--dry-run] [--out <result.json>]
//       Validál, upsertel egyetlen tranzakcióban, és result JSON-t ír a
//       riporthoz. --dry-run: mindent kiszámol, de a végén ROLLBACK.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const requireFromDb = createRequire(
  resolve(REPO_ROOT, 'packages/db/package.json'),
);
const { Client } = requireFromDb('pg');

// Az értékkészletek a docs/ddd/glossary.md-ből / schema.prisma kommentjeiből.
const ALLOWED = {
  category: [
    'szobanövény',
    'kerti',
    'pozsgás',
    'kaktusz',
    'fűszer',
    'fa-cserje',
    'lógó',
    'virágzó',
  ],
  location: ['beltéri', 'kültéri', 'mindkettő'],
  light: ['árnyék', 'alacsony', 'közepes', 'erős', 'direkt nap'],
  watering: ['ritka', 'közepes', 'gyakori', 'állandóan nedves'],
  difficulty: ['kezdő', 'haladó', 'profi'],
};

// Feedből mindig felülírt mezők vs. csak akkor írt mezők, ha van új érték
// (a meglévő, pl. kézzel pótolt adatot null nem törli).
const FEED_OWNED = ['name', 'price', 'sale_price', 'stock'];
const FILL_ONLY = [
  'latin_name',
  'category',
  'location',
  'light',
  'watering',
  'difficulty',
  'current_height_cm',
  'max_height_cm',
  'current_pot_cm',
  'pet_safe',
  'kid_safe',
  'air_purifying',
];
const COLUMNS = [...FEED_OWNED, ...FILL_ONLY, 'description'];

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = readFileSync(resolve(REPO_ROOT, '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((l) => /^\s*DATABASE_URL\s*=/.test(l));
  if (!line)
    throw new Error('DATABASE_URL nincs beállítva (sem env, sem .env).');
  return line
    .replace(/^\s*DATABASE_URL\s*=\s*/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function toRow(item, warnings) {
  const where = `${item.source}/${item.handle}`;
  const row = {
    name: item.name ?? null,
    latin_name: item.latinName ?? null,
    category: item.category ?? null,
    location: item.location ?? null,
    price: item.priceHuf ?? null,
    sale_price: item.salePriceHuf ?? null,
    stock: item.available === undefined ? null : item.available ? 1 : 0,
    light: item.light ?? null,
    watering: item.watering ?? null,
    difficulty: item.difficulty ?? null,
    current_height_cm: item.currentHeightCm ?? null,
    max_height_cm: item.maxHeightCm ?? null,
    current_pot_cm: item.currentPotCm ?? null,
    pet_safe: item.petSafe ?? null,
    kid_safe: item.kidSafe ?? null,
    air_purifying: item.airPurifying ?? null,
    description: item.description ?? null,
  };
  for (const [field, allowed] of Object.entries(ALLOWED)) {
    if (row[field] !== null && !allowed.includes(row[field])) {
      warnings.push(`${where}: érvénytelen ${field} "${row[field]}" → null`);
      row[field] = null;
    }
  }
  // Domain-szabály (docs/ddd/model.md): akciós az, aminek sale_price < price.
  if (
    row.sale_price !== null &&
    !(row.price !== null && row.sale_price < row.price)
  ) {
    warnings.push(
      `${where}: sale_price (${row.sale_price}) nem kisebb a price-nál (${row.price}) → sale_price = null`,
    );
    row.sale_price = null;
  }
  if (!row.name) throw new Error(`${where}: hiányzó name`);
  return row;
}

// A pg a DECIMAL oszlopokat stringként adja vissza ("8990.000…") — ezeket
// számként hasonlítjuk és jelenítjük meg, különben minden futás "változást" látna.
const NUMERIC = new Set([
  'price',
  'sale_price',
  'stock',
  'current_height_cm',
  'max_height_cm',
  'current_pot_cm',
]);
const normCol = (c, v) =>
  v === null || v === undefined ? null : NUMERIC.has(c) ? Number(v) : v;
const same = (a, b) =>
  a === null || b === null ? a === b : String(a) === String(b);

async function listExisting(client, file) {
  const { items } = JSON.parse(readFileSync(file, 'utf8'));
  const result = [];
  for (const { source, handle } of items) {
    const { rows } = await client.query(
      'SELECT id, description FROM products WHERE source = $1 AND source_handle = $2',
      [source, handle],
    );
    result.push({
      source,
      handle,
      exists: rows.length > 0,
      hasDescription: Boolean(rows[0]?.description),
    });
  }
  console.log(JSON.stringify(result, null, 2));
}

async function upsertAll(client, file, dryRun, outPath) {
  const input = JSON.parse(readFileSync(file, 'utf8'));
  // Csomag/kollekció-szabály: a kizárt tételek nem kerülnek a táblába, de
  // figyelmeztetésként megjelennek a riportban.
  const excluded = (input.excluded ?? []).map((e) => ({
    source: e.source,
    handle: e.handle,
    url: e.url ?? null,
    name: e.name ?? e.handle,
    reason: e.reason ?? 'csomag/kollekció',
  }));
  const warnings = excluded.map(
    (e) => `${e.source}/${e.handle}: kizárva — ${e.reason}`,
  );
  const inserted = [];
  const updated = [];
  const unchanged = [];

  await client.query('BEGIN');
  try {
    for (const item of input.items) {
      const row = toRow(item, warnings);
      const { rows } = await client.query(
        `SELECT id, ${COLUMNS.join(', ')} FROM products WHERE source = $1 AND source_handle = $2 FOR UPDATE`,
        [item.source, item.handle],
      );
      const summary = {
        source: item.source,
        handle: item.handle,
        url: item.url ?? null,
        name: row.name,
      };

      if (rows.length === 0) {
        const cols = [...COLUMNS, 'source', 'source_handle'];
        const values = [
          ...COLUMNS.map((c) => row[c]),
          item.source,
          item.handle,
        ];
        await client.query(
          `INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          values,
        );
        inserted.push({
          ...summary,
          price: row.price,
          salePrice: row.sale_price,
          stock: row.stock,
        });
        continue;
      }

      const old = rows[0];
      const next = { ...row };
      for (const c of FILL_ONLY)
        if (next[c] === null) next[c] = normCol(c, old[c]);
      // A meglévő leírást nem írjuk felül (a skill csak újhoz/üreshez ír).
      if (old.description) next.description = old.description;

      const changes = {};
      for (const c of COLUMNS) {
        if (!same(normCol(c, old[c]), next[c]))
          changes[c] = [normCol(c, old[c]), next[c]];
      }
      if (Object.keys(changes).length === 0) {
        unchanged.push({
          ...summary,
          price: next.price,
          salePrice: next.sale_price,
          stock: next.stock,
        });
        continue;
      }
      await client.query(
        `UPDATE products SET ${COLUMNS.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${COLUMNS.length + 1}`,
        [...COLUMNS.map((c) => next[c]), old.id],
      );
      updated.push({
        ...summary,
        price: next.price,
        salePrice: next.sale_price,
        stock: next.stock,
        changes,
      });
    }
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  const onSale = [...inserted, ...updated, ...unchanged].filter(
    (p) => p.salePrice !== null && p.price !== null && p.salePrice < p.price,
  );
  const result = {
    runAt: new Date().toISOString(),
    dryRun,
    request: input.request ?? null,
    sources: input.sources ?? [...new Set(input.items.map((i) => i.source))],
    usdHufRate: input.usdHufRate ?? null,
    usdHufRateDate: input.usdHufRateDate ?? null,
    counts: {
      inserted: inserted.length,
      updated: updated.length,
      unchanged: unchanged.length,
      onSale: onSale.length,
      excluded: excluded.length,
      warnings: warnings.length,
    },
    inserted,
    updated,
    unchanged,
    onSale,
    excluded,
    warnings,
  };
  const out = resolve(outPath ?? 'tmp/product-sync/result.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(
    `${dryRun ? '[DRY-RUN] ' : ''}új: ${inserted.length}, változott: ${updated.length}, változatlan: ${unchanged.length}, akciós: ${onSale.length}, kizárt csomag: ${excluded.length}, figyelmeztetés: ${warnings.length} → ${out}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const client = new Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  try {
    if (args[0] === '--existing') {
      await listExisting(client, args[1]);
    } else {
      const outIdx = args.indexOf('--out');
      await upsertAll(
        client,
        args[0],
        args.includes('--dry-run'),
        outIdx >= 0 ? args[outIdx + 1] : null,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
