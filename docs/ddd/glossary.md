# Plantbase — domain-glosszárium

> A Plantbase domain-fogalmai (ubiquitous language): magyar név, kódbeli azonosító, DB-oszlop, jelentés, megengedett értékek. Forrás: `packages/db/prisma/schema.prisma`, `packages/db/prisma/seed.ts`, a toolok (`packages/core/src/tools/`) és a system prompt (`docs/system-prompt.md`). Karbantartás: a `ddd-audit` skill (`.claude/skills/ddd-audit/`). Az entitások, invariánsok és a még nem modellezett fogalmak: `model.md`.

## Termék (katalógus)

| Fogalom | Kód | DB | Jelentés / megengedett értékek |
|---|---|---|---|
| Termék (növény) | `Product` | `products` | A webshop katalógusának egy tétele. |
| Köznapi név | `name` | `name` | A növény magyar/köznapi neve. |
| Latin név | `latinName` | `latin_name` | Tudományos név. |
| Kategória | `category` | `category` | `szobanövény` / `kerti` / `pozsgás` / `kaktusz` / `fűszer` / `fa-cserje` / `lógó` / `virágzó` |
| Helyszín | `location` | `location` | `beltéri` / `kültéri` / `mindkettő` |
| Ár | `price` | `price` | Listaár, Ft. |
| Akciós ár | `salePrice` | `sale_price` | Akció esetén a csökkentett ár (Ft), különben `null`. |
| Akciós termék | – | `sale_price < price` | Az a termék, amelynek akciós ára kisebb a listaáránál. |
| Tényleges ár | – | `COALESCE(sale_price, price)` | Az ár, amivel a vásárló fizet; költségkeretnél (büdzsé) ezzel számolunk. |
| Raktárkészlet | `stock` | `stock` | Darabszám. |
| Raktáron | – | `stock > 0` | Van belőle legalább egy darab. |
| Fényigény | `light` | `light` | `árnyék` / `alacsony` / `közepes` / `erős` / `direkt nap` |
| Öntözés | `watering` | `watering` | `ritka` / `közepes` / `gyakori` / `állandóan nedves` |
| Nehézség | `difficulty` | `difficulty` | `kezdő` / `haladó` / `profi` |
| Aktuális magasság | `currentHeightCm` | `current_height_cm` | cm |
| Kifejlett (max) magasság | `maxHeightCm` | `max_height_cm` | cm |
| Cserépméret | `currentPotCm` | `current_pot_cm` | Aktuális cserép, cm. |
| Háziállat-barát | `petSafe` | `pet_safe` | igen/nem |
| Gyerekbiztos | `kidSafe` | `kid_safe` | igen/nem (nem mérgező) |
| Légtisztító | `airPurifying` | `air_purifying` | igen/nem |
| Értékelés | `rating` | `rating` | 0–5 |
| Értékelések száma | `reviewsCount` | `reviews_count` | darab |
| Leírás | `description` | `description` | Szabad szöveg. |

## Ügyfél

> **Ideiglenes, egyszerűsített modell** — lásd `model.md`.

| Fogalom | Kód | DB | Jelentés / megengedett értékek |
|---|---|---|---|
| Ügyfél | `CustomerPreference.name` | – | Névvel azonosított ügyfél; jelenleg: Exeter, Komi, Duline. |
| Ügyfélpreferencia | `CustomerPreference` | – (statikus lista, `customer-preferences-tool.ts`) | Egy ügyfél korábban rögzített vásárlási igényei. |
| Költségkeret (büdzsé) | `budget` | – | Ft; a tényleges árral vetjük össze (`COALESCE(sale_price, price) <= budget`). |
| Igényelt fény | `light` | – | A termék fényigényével azonos szókincs; alapértelmezésben pontos egyezés (`light = <érték>`). |
| Háziállat-biztonság igénye | `petSafe` | – | Ha igaz, csak háziállat-barát termék (`pet_safe = true`) jöhet szóba. |

## Tudásbázis

| Fogalom | Kód | DB | Jelentés / megengedett értékek |
|---|---|---|---|
| Tudásbázis-cikkrészlet | `KnowledgeChunk` | `knowledge_chunks` | Növénygondozási cikk egy szakasza. |
| Cikk címe | `title` | `title` | A válaszban forrásként idézendő. |
| Forrás | `source` | `source` | A cikk URL-je; a válaszban forrásként idézendő. |

## Eszkaláció

| Fogalom | Kód | DB | Jelentés / megengedett értékek |
|---|---|---|---|
| Eszkaláció | `[ESCALATE] ` válasz-prefix | – | Kollégához irányítás: rendelés, szállítás, számlázás, visszáru, reklamáció, vagy ha a tudásbázisban nincs releváns találat. |
