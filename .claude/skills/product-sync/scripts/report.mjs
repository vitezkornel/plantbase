#!/usr/bin/env node
// product-sync — HTML riport az upsert result JSON-jából (új / változott /
// akciós / figyelmeztetések), majd megnyitás az alapértelmezett böngészőben.
// Nincs függősége.
//
// Használat:
//   node report.mjs <result.json> [--out <report.html>] [--no-open]

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const FIELD_LABELS = {
  name: 'Név',
  latin_name: 'Latin név',
  category: 'Kategória',
  location: 'Helyszín',
  price: 'Ár',
  sale_price: 'Akciós ár',
  stock: 'Elérhető',
  light: 'Fényigény',
  watering: 'Öntözés',
  difficulty: 'Nehézség',
  current_height_cm: 'Magasság',
  max_height_cm: 'Kifejlett magasság',
  current_pot_cm: 'Cserép',
  pet_safe: 'Háziállat-barát',
  kid_safe: 'Gyerekbiztos',
  air_purifying: 'Légtisztító',
  description: 'Leírás',
};

const esc = (v) =>
  String(v ?? '–').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const huf = (v) =>
  v === null || v === undefined
    ? '–'
    : `${Math.round(v).toLocaleString('hu-HU').replace(/ /g, ' ')} Ft`;
const fmt = (field, v) => {
  if (v === null || v === undefined) return '–';
  if (field === 'price' || field === 'sale_price') return huf(v);
  if (field === 'stock') return Number(v) > 0 ? 'igen' : 'nem';
  if (typeof v === 'boolean') return v ? 'igen' : 'nem';
  if (field === 'description')
    return String(v).length > 80 ? `${String(v).slice(0, 80)}…` : v;
  return v;
};
const nameCell = (p) =>
  p.url
    ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>`
    : esc(p.name);
const discount = (p) => Math.round((1 - p.salePrice / p.price) * 100);

function table(head, rows) {
  if (rows.length === 0) return '<p class="empty">Nincs ilyen tétel.</p>';
  return `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function render(r) {
  const inserted = table(
    ['Termék', 'Forrás', 'Ár', 'Akciós ár', 'Elérhető'],
    r.inserted.map(
      (p) =>
        `<tr><td>${nameCell(p)}</td><td>${esc(p.source)}</td><td class="num">${huf(p.price)}</td><td class="num">${huf(p.salePrice)}</td><td>${fmt('stock', p.stock)}</td></tr>`,
    ),
  );
  const updated = table(
    ['Termék', 'Forrás', 'Változások'],
    r.updated.map(
      (p) =>
        `<tr><td>${nameCell(p)}</td><td>${esc(p.source)}</td><td><ul class="changes">${Object.entries(
          p.changes,
        )
          .map(
            ([f, [a, b]]) =>
              `<li><span class="field">${esc(FIELD_LABELS[f] ?? f)}:</span> <del>${esc(fmt(f, a))}</del> → <ins>${esc(fmt(f, b))}</ins></li>`,
          )
          .join('')}</ul></td></tr>`,
    ),
  );
  const onSale = table(
    ['Termék', 'Forrás', 'Eredeti ár', 'Akciós ár', 'Kedvezmény'],
    [...r.onSale]
      .sort((a, b) => discount(b) - discount(a))
      .map(
        (p) =>
          `<tr><td>${nameCell(p)}</td><td>${esc(p.source)}</td><td class="num"><del>${huf(p.price)}</del></td><td class="num">${huf(p.salePrice)}</td><td class="num"><span class="badge">−${discount(p)}%</span></td></tr>`,
      ),
  );
  const excluded = table(
    ['Tétel', 'Forrás', 'Ok'],
    (r.excluded ?? []).map(
      (p) =>
        `<tr><td>${nameCell(p)}</td><td>${esc(p.source)}</td><td>${esc(p.reason)}</td></tr>`,
    ),
  );
  const warnings = r.warnings.length
    ? `<ul class="warnings">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
    : '<p class="empty">Nincs figyelmeztetés.</p>';
  const runAt = new Date(r.runAt).toLocaleString('hu-HU');
  const rate = r.usdHufRate
    ? `<p class="meta">USD→HUF árfolyam: 1 USD = ${r.usdHufRate} Ft (rögzítve: ${esc(r.usdHufRateDate)})</p>`
    : '';

  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Termék-szinkron riport</title>
<style>
  :root { --bg:#f7f7f4; --card:#fff; --text:#1d2521; --muted:#5f6b64; --line:#e3e6e1; --accent:#2f6b4f; --sale:#b4432b; --ins:#1f7a4d; --del:#8a8f8b; --warn-bg:#fff6e0; --warn:#7a5a00; }
  @media (prefers-color-scheme: dark) { :root { --bg:#141816; --card:#1c211f; --text:#e6ebe8; --muted:#9aa59f; --line:#2c3430; --accent:#7cc4a0; --sale:#f08a70; --ins:#7cd3a5; --del:#7d8581; --warn-bg:#2e2710; --warn:#e8c86a; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:1100px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:1.5rem; margin:0 0 4px; }
  h2 { font-size:1.1rem; margin:32px 0 12px; }
  .meta { color:var(--muted); margin:2px 0; font-size:.9rem; }
  .dry { display:inline-block; background:var(--warn-bg); color:var(--warn); padding:2px 8px; border-radius:6px; font-weight:600; font-size:.85rem; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-top:20px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
  .stat b { display:block; font-size:1.6rem; font-variant-numeric:tabular-nums; }
  .stat span { color:var(--muted); font-size:.85rem; }
  .scroll { overflow-x:auto; background:var(--card); border:1px solid var(--line); border-radius:10px; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:.8rem; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:600; }
  tr:last-child td { border-bottom:0; }
  .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  a { color:var(--accent); }
  del { color:var(--del); } ins { color:var(--ins); text-decoration:none; font-weight:600; }
  .changes { margin:0; padding-left:18px; } .field { color:var(--muted); }
  .badge { background:var(--sale); color:#fff; border-radius:6px; padding:1px 7px; font-weight:600; font-size:.85rem; }
  .empty { color:var(--muted); font-style:italic; }
  .warnings { background:var(--warn-bg); color:var(--warn); border-radius:10px; padding:12px 12px 12px 32px; margin:0; }
</style>
</head>
<body>
<main>
  <h1>Termék-szinkron riport ${r.dryRun ? '<span class="dry">DRY-RUN — nem mentve</span>' : ''}</h1>
  <p class="meta">${esc(runAt)} · Források: ${esc(r.sources.join(', '))}</p>
  ${r.request ? `<p class="meta">Kérés: „${esc(r.request)}”</p>` : ''}
  ${rate}
  <div class="stats">
    <div class="stat"><b>${r.counts.inserted}</b><span>új termék</span></div>
    <div class="stat"><b>${r.counts.updated}</b><span>változott</span></div>
    <div class="stat"><b>${r.counts.onSale}</b><span>akciós</span></div>
    <div class="stat"><b>${r.counts.unchanged}</b><span>változatlan</span></div>
    <div class="stat"><b>${r.counts.excluded ?? 0}</b><span>kizárt csomag</span></div>
  </div>
  <h2>Új termékek</h2>${inserted}
  <h2>Változott termékek</h2>${updated}
  <h2>Akciós termékek</h2>${onSale}
  <h2>Kizárt tételek (csomag / kollekció)</h2>${excluded}
  <h2>Figyelmeztetések</h2>${warnings}
</main>
</body>
</html>`;
}

function openInBrowser(file) {
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', file]]
      : process.platform === 'darwin'
        ? ['open', [file]]
        : ['xdg-open', [file]];
  execFile(cmd, args, (error) => {
    if (error)
      console.error(`Nem sikerült megnyitni a böngészőt: ${error.message}`);
  });
}

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const result = JSON.parse(readFileSync(args[0], 'utf8'));
const stamp = result.runAt.replace(/[:.]/g, '-');
const out = resolve(
  outIdx >= 0 ? args[outIdx + 1] : `tmp/product-sync/report-${stamp}.html`,
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, render(result));
console.log(`Riport: ${out}`);
if (!args.includes('--no-open')) openInBrowser(out);
