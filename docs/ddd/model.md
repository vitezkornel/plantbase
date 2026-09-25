# Plantbase — domain-modell

> A Plantbase domain-modellje a kód jelenlegi állapota szerint: entitások, kapcsolatok, invariánsok, és a még nem modellezett fogalmak. A fogalmak pontos definíciója és értékkészletei: `glossary.md`. Karbantartás: a `ddd-audit` skill (`.claude/skills/ddd-audit/`).

## Entitások

### Termék (`Product`, `products` tábla)

A központi entitás: a webshop katalógusának egy növénye. Forrás: `packages/db/prisma/schema.prisma`.

- **Azonosítás:** `id` (autoincrement).
- **Leírás:** `name`, `latinName`, `description`.
- **Besorolás:** `category`, `location`.
- **Kereskedelem:** `price`, `salePrice`, `stock`.
- **Gondozás:** `light`, `watering`, `difficulty`.
- **Méret:** `currentHeightCm`, `maxHeightCm`, `currentPotCm`.
- **Tulajdonságok:** `petSafe`, `kidSafe`, `airPurifying`.
- **Visszajelzés:** `rating`, `reviewsCount`.

### Ügyfélpreferencia (`CustomerPreference`) — ideiglenes, egyszerűsített modell

Egy névvel azonosított ügyfél rögzített vásárlási igényei: `name`, `budget`, `light`, `petSafe`. Forrás: `packages/core/src/tools/customer-preferences/customer-preferences-tool.ts`.

**Ideiglenes:** nincs DB-táblája, a kódban tárolt statikus lista (3 ügyfél), és nincs saját azonosítója a néven túl. Az ügyfél nem önálló entitás: csak a preferenciáin keresztül létezik. Egy valódi ügyfél-modell (tábla, azonosító, több preferencia/szoba ügyfelenként) későbbi döntés tárgya.

### Tudásbázis-cikkrészlet (`KnowledgeChunk`, `knowledge_chunks` tábla)

Növénygondozási cikk egy szakasza, forrás-hivatkozással (`title`, `source`) és opcionális szakasz-útvonallal (`sectionPath`). Az `embedding`, `contentHash` stb. mezők a keresés infrastruktúrájához tartoznak, nem domain-fogalmak.

## Kapcsolatok

- **Ügyfélpreferencia → Termék:** nincs tárolt kapcsolat; az ajánlás szűrésként jön létre:
  - tényleges ár (`COALESCE(sale_price, price)`) `<=` `budget`
  - `products.light` `=` a preferencia `light` értéke (alapértelmezésben **pontos egyezés**)
  - ha `petSafe` igaz: `pet_safe = true`
- **Tudásbázis-cikkrészlet ↔ Termék:** nincs kapcsolat; a tudásbázis a katalógustól független.

## Invariánsok és szabályok

- **Akciós termék:** akciós az a termék, amelynek `sale_price < price`. Ha nincs akció, `sale_price` `null`.
- **Tényleges ár:** `COALESCE(sale_price, price)`; minden költségkeret-számítás ezzel történik.
- **Raktáron:** `stock > 0`.
- **Fényigény-egyezés:** ügyfélpreferencia alapján alapértelmezésben pontos egyezés; szomszédos fényszintek (pl. `erős` ↔ `direkt nap`) nem számítanak egyezésnek.
- **Értékkészletek:** a kategorikus mezők (`category`, `location`, `light`, `watering`, `difficulty`) szabad szöveges oszlopok; az értékkészletet csak konvenció rögzíti (séma-kommentek, a seed TypeScript-típusa, a system prompt) — nincs DB-szintű enum vagy CHECK constraint.
- **Kitöltöttség:** a DB-ben minden `products` oszlop nullable; a seed minden mezőt kitölt, kivéve a `sale_price`-t.
- **Csak olvasás:** a domain-modellt az agent kizárólag olvassa, soha nem módosítja.

## Még nem modellezett fogalmak

A `docs/brs-plantbase.md`-ben szerepelnek, de a kódban / sémában nincs megfelelőjük:

- **Szoba és adottságai** — a szoba fénye, mérete és **színe**. A fény és a méret ma csak a kérdésből, szabad szövegként jut el az agenthez, és a termék `light` / méret-mezőire képződik le; a szín semmilyen termék-attribútumra nem képződik le.
- **Növénycsomag** — egy szobára / ügyfélre összeállított termék-válogatás (összár, költségkeret). Ma csak az agent válaszában, ad hoc létezik; nincs tárolt entitása.
