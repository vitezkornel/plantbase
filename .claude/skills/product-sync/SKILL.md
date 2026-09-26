---
name: product-sync
description: A Plantbase products tábláját frissíti webshop-feedekből (tropicalhome.hu/products.json, thesill.com/products.json) természetes nyelvű szűkítéssel (pl. „csak a fikuszokat”, „az akciós szobanövényeket”) — letölti a feedet, szűkít, minden termékhez saját szavas magyar leírást ír, upsertel, és HTML riportot nyit (új / változott / akciós). Használd, ha a felhasználó a katalógust feedből, webshopból vagy a tropicalhome / The Sill kínálatából akarja feltölteni, frissíteni, szinkronizálni, árakat vagy akciókat behúzni — akkor is, ha nem mondja ki a „sync” szót (pl. „töltsd be a tropicalhome hoyáit”, „frissítsd az árakat a feedből”).
---

# product-sync

Fejlesztői (L1) eszköz: webshop-feedekből frissíti a `products` táblát. **Nem része a Plantbase terméknek** — a termék-agent read-only; ez a skill a read-write `DATABASE_URL`-en ír, ugyanúgy, mint a seed.

## Előfeltételek

- Fut a `plantbase-postgres` konténer, és a `add_product_source` migráció le van futtatva (a `products.source` + `source_handle` oszlopok az upsert kulcsa).
- A scriptek a repó gyökeréből futnak (`node .claude/skills/product-sync/scripts/<script>.mjs …`); minden köztes fájl a gitignore-olt `tmp/product-sync/` alá kerül.

## Munkafolyamat

### 1. Feed letöltése

```bash
node .claude/skills/product-sync/scripts/fetch-feed.mjs <source> [--match "<regex>"]
```

- `<source>`: `tropicalhome.hu` (HUF) vagy `thesill.com` (USD — a script a fix `USD_HUF_RATE` árfolyammal forintra váltja).
- Ha a kérés nem nevez meg forrást, mindkettőt töltsd le.
- A `--match` csak **durva előszűrés** (cím, típus, címkék, handle), hogy ne kelljen több száz terméket átnézni. Legyen bő: magyar és angol/latin alak is (pl. `"ficus|fikusz"`). Ha a kérés nem szűkít, hagyd el.
- A kimenet normalizált: `priceHuf` (eredeti ár), `salePriceHuf` (csak ha a feedben `compare_at_price > price`), `available`, `tags`, `bodyText`, `url`, `bundleHint` (csomag-gyanú, lásd lent).

### 2. Szűkítés a kérés szerint

Olvasd el a letöltött `tmp/product-sync/<source>.json`-t, és válaszd ki, ami ténylegesen megfelel a kérésnek. A regex-találat nem döntés: pl. „fikuszok” kérésre egy „Ficus-mintás kaspó” nem kell. **Csak élő növény** kerüljön be: a kaspó, cserép, föld, tápoldat, kiegészítő, művirág (`Kaspók`, `Soil`, `Accessories`, `Accessory`, `Planter`, `Consumable`, `Faux` típusok) nem termék ebben a katalógusban. Ha a szűkítés után 0 vagy gyanúsan sok (≈ 50+) termék maradt, állj meg és kérdezz rá.

**Csak egyedi növény — csomag/kollekció soha.** A katalógus egy sora egy növény: ára, mérete, fényigénye egy növényre vonatkozik, így egy több növényből álló tétel (csomag, kollekció, duo/trio, party pack, bundle, orchard pack, ápolókészlet) hamis adatot adna az agentnek. Szabály:

- Minden tétel, amelynek a `bundleHint` mezője nem `null` (a `fetch-feed.mjs` a címből/handle-ből jelöli: _bundle, pack, kit, set, collection, assortment, trio, duo, orchard, kollekció, csomag, szett, válogatás_), **kizárt** — akkor is, ha egyébként illik a kérésre. Nem mérlegeled egyenként.
- Ha a heurisztika nem jelölte, de a cím vagy a variáns egyértelműen több növényt ír (pl. „3 db”, „3 plants”), azt is zárd ki, saját indoklással.
- Egy növény több oltvánnyal (pl. „3-in-1 Apple”, „Fruit Cocktail Tree”) egyedi növény, nem csomag.
- A kérésre illő, de kizárt tételeket az `enriched.json` `excluded` tömbjébe írd (`source`, `handle`, `url`, `name`, `reason`): az upsert nem írja őket a táblába, de a riport figyelmeztetésként és külön „Kizárt tételek” szekcióban mutatja.

### 3. Mezők kitöltése és magyar leírás

Előbb nézd meg, mi van már a táblában, hogy csak az új / leírás nélküli termékekhez kelljen leírást írni:

```bash
node .claude/skills/product-sync/scripts/upsert.mjs --existing tmp/product-sync/<source>.json
```

Ezután írd meg a `tmp/product-sync/enriched.json`-t (formátum lent).

**Explicit adat = csak strukturált feed-mező vagy címke.** A mezőket kizárólag a feed strukturált részeiből töltöd: `title`, `productType`, `tags` (a lenti táblázat szerinti címkék), valamint a fetch-feed ár-/akció-/elérhetőség-mezői. A szabadszöveges leírásból (`bodyText`) **soha nem következtetsz semmilyen mezőt** — akkor sem, ha egyértelműnek tűnik („tartsd mindig nedvesen”, „Méret: 12 cm”, „világos, szórt fényt szeret”). Ha egy mezőhöz nincs a táblázatban felsorolt strukturált forrás, az értéke `null`. A `bodyText` csak a leírás megírásához használható. Ennek oka: a szabad szöveg futásról futásra másképp értelmezhető, és a katalógusban egy rossz adat (pl. hamis „háziállat-barát”) rosszabb a hiányzónál, mert az agent erre szűrve ajánl — a strukturált címke viszont determinisztikusan ugyanazt adja.

| Mező               | Strukturált forrás                                         | Szabály                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`             | `title`                                                    | Magyar köznapi név, ha a cím tartalmazza (pl. „Törpe lantlevelű fikusz”), különben a cím fajta-része méret/szín nélkül.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `latinName`        | `Botanical Name:` címke, vagy a cím latin része            | Úgy, ahogy a feedben szerepel — nem javítod, nem egészíted ki.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `category`         | `productType`, `Category:` / `Subcategory:` címke, `title` | A 8 érték egyike: `szobanövény`, `kerti`, `pozsgás`, `kaktusz`, `fűszer`, `fa-cserje`, `lógó`, `virágzó`. Futó/csüngő (Hoya, Epipremnum, `Futónövény`, `Vining plants`) → `lógó`; `Outdoor Plant` + fa/cserje kategória → `fa-cserje`. Ha a strukturált mezőkből nem egyértelmű: `null`.                                                                                                                                                                                                                                                       |
| `location`         | `productType`                                              | `Indoor Plant` / tropicalhome növénytípus → `beltéri`; `Outdoor Plant` → `kültéri`.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `light`            | címke                                                      | `Árnyéktűrő`, `low-light` → `alacsony`; `indirect-light`, `Sunlight Value: Indirect Light` → `közepes`; `Világos helyre`, `bright-light`, `brightlight` → `erős`; `Sunlight Value:` (a régi `Sunlight:` kulcs ugyanígy) `Full-Part Sun` → `erős`, `Part Sun` → `erős`, `Full Sun` → `direkt nap`, `Shade` → `árnyék`; `pcp-light:Bright direct light` → `direkt nap`. A `medium` címke **nem** fénycímke (méretet jelöl), figyelmen kívül hagyod. Több fénycímkénél a világosabb szint (az „-tűrő” csak alsó határ). Nincs fénycímke → `null`. |
| `watering`         | –                                                          | Mindig `null` (egyik feedben sincs öntözési címke).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `difficulty`       | címke                                                      | `Kezdőknek`, `easy-care`, `bestbeginners`, `best-beginner`, `bestforbeginners` → `kezdő`; egyébként `null`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `currentHeightCm`  | –                                                          | Mindig `null` (nincs rá strukturált mező).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `currentPotCm`     | címke                                                      | tropicalhome méretcímke (`12 cm`, `6cm`, `10.5 cm`) → szám; egyébként `null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `maxHeightCm`      | `Mature Height Value:` / `Mature Height:` címke            | Felső határ cm-ben (ft × 30,48, in. × 2,54), kerekítve; `Varies` → `null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `petSafe`          | címke                                                      | `Háziállat-barát`, `pet-friendly`, `pet-friendly-original` → `true`. Címke hiánya **nem** `false`, hanem `null`.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `kidSafe`          | –                                                          | Mindig `null` (egyik feed sem mondja ki).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `airPurifying`     | címke                                                      | `Légtisztító`, `air-purifying` → `true`; egyébként `null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ár, akció, készlet | fetch-feed kimenete                                        | Változatlanul átveszed: `priceHuf`, `salePriceHuf`, `available`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Leírás (`description`)** — csak ha a termék új, vagy nincs még leírása: 2–4 mondat, természetes magyar nyelven, **saját szavaiddal**. Ne fordítsd és ne parafrazeáld mondatonként a forrást (szerzői jog, és a katalógus saját hangja): a feedből vett tényekből (megjelenés, növekedés, fényigény, gondozás nehézsége) írj új szöveget, a lakberendező szemszögéből (hová illik, mire figyeljen). Ne állíts semmit, ami nincs a feedben — főleg mérgezőséget, háziállat- vagy gyerekbiztonságot ne.

`enriched.json` formátum:

```json
{
  "request": "<a felhasználó kérése szó szerint>",
  "sources": ["tropicalhome.hu"],
  "usdHufRate": null,
  "usdHufRateDate": null,
  "items": [
    {
      "source": "tropicalhome.hu",
      "handle": "ficus-lyrata-bambino-9cm",
      "url": "https://tropicalhome.hu/products/ficus-lyrata-bambino-9cm",
      "name": "Törpe lantlevelű fikusz",
      "latinName": "Ficus lyrata 'Bambino'",
      "category": "szobanövény",
      "location": "beltéri",
      "priceHuf": 3500,
      "salePriceHuf": null,
      "available": true,
      "light": "erős",
      "watering": null,
      "difficulty": null,
      "currentHeightCm": null,
      "maxHeightCm": null,
      "currentPotCm": 9,
      "petSafe": null,
      "kidSafe": null,
      "airPurifying": null,
      "description": "…"
    }
  ],
  "excluded": [
    {
      "source": "tropicalhome.hu",
      "handle": "hoya-csomag-kezdoknek-8cm",
      "url": "https://tropicalhome.hu/products/hoya-csomag-kezdoknek-8cm",
      "name": "Hoya csomag kezdőknek 8cm",
      "reason": "csomag/kollekció („csomag” a címben/handle-ben)"
    }
  ]
}
```

A `usdHufRate` / `usdHufRateDate` értékét thesill-termékeknél vedd át a fetch-feed kimenetéből, hogy a riportban látsszon. Meglévő leírású terméknél hagyd el a `description`-t (vagy `null`) — az upsert úgyis megtartja a meglévőt.

### 4. Upsert — előbb dry-run

```bash
node .claude/skills/product-sync/scripts/upsert.mjs tmp/product-sync/enriched.json --dry-run
node .claude/skills/product-sync/scripts/upsert.mjs tmp/product-sync/enriched.json
```

A dry-run ugyanazt számolja, de visszagörget. Ha a figyelmeztetések vagy a számok (pl. váratlanul sok „változott”) gyanúsak, javítsd az `enriched.json`-t és futtasd újra; ha rendben van, jöhet az éles futás.

Mit csinál az upsert (egy tranzakcióban):

- Kulcs: `(source, source_handle)`; a seed-termékeket (ahol ezek `null`-ok) nem érinti.
- `name`, `price`, `sale_price`, `stock` mindig a feedből frissül; a többi mezőt csak akkor írja, ha van új érték (a `null` nem töröl meglévő adatot); a meglévő `description`-t nem írja felül.
- `stock`: `available` → `1` / `0` (feedes terméknél elérhetőség, nem darabszám).
- Domain-szabály: akciós az, aminek `sale_price < price` — ha nem így van, a `sale_price` `null` lesz, figyelmeztetéssel. Érvénytelen kategória-/fény-/öntözés-/nehézség-érték szintén `null` + figyelmeztetés.

### 5. HTML riport

```bash
node .claude/skills/product-sync/scripts/report.mjs tmp/product-sync/result.json
```

A riport (`tmp/product-sync/report-<időbélyeg>.html`) az új, változott (régi → új érték) és akciós termékeket, a kizárt csomagokat, valamint a figyelmeztetéseket mutatja, és megnyílik az alapértelmezett böngészőben.

Zárásként a felhasználónak röviden: forrás(ok), a kérés szerinti szűkítés eredménye, új / változott / akciós / kizárt darabszám, a figyelmeztetések lényege és a riport útvonala.

## Ha változik a domain-modell

A skill a `docs/ddd/glossary.md` értékkészleteit használja (az `upsert.mjs` `ALLOWED` táblája is). Ha azok változnak, ezt a skillt és a scriptet is igazítsd.

## Ismert korlátok

A tesztkörök (3 dry-run eval, 95%) alapján ezek futásonként eltérően alakulhatnak; egyelőre nem javítottuk őket, élesítés előtt érdemes kézzel ránézni:

- **Kategória-kétértelműség:** a `category` szabály nem mondja ki, hogy a cím egy jelzője (pl. „Kapaszkodó / Creeping”) elég-e a `lógó` kategóriához, ha nincs rá címke vagy terméktípus. Ugyanaz a termék (Ficus pumila) egyik futásban `szobanövény`, másikban `lógó` lett.
- **Az `excluded` lista félrecímkézése:** a modell nem csomag tételt is az `excluded` tömbbe tehet (pl. egy „Akciós” címkéjű, de valódi leárazás nélküli terméket), a riport viszont minden `excluded` tételt „kizárt csomag”-ként számol és mutat — így a „kizárt csomag” szám nagyobb lehet a tényleges csomagok számánál.
- **Több növényt tartalmazó tétel csak a leírásból felismerve:** ha a cím és a variáns nem jelzi, de a szabad szöveg igen (pl. a Romeo cherry egy cserépben a Juliet cherryvel), a modell kizárhatja a leírás alapján — ez túlmegy a „cím vagy variáns” szabályon, és futásonként eltérhet.
