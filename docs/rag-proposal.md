# RAG-javaslat (HF3) — `packages/rag` + keresési pipeline

> Ez a dokumentum a HF3 build-terve: hogyan bővül a Plantbase egy RAG-réteggel a
> meglévő 202 gondozási cikken (B opció, `docs/HF3-hazifeladat.pdf`). A
> chunking-döntések indoklása a `docs/dontesek-hf3.md`-ben található — ez a
> dokumentum azokra épít, és a végrehajtható tervet adja hozzá: csomagstruktúra,
> adatbázis-séma, provider-routing, keresési pipeline, tesztelés, fázisolt
> lépések. Az `implementacios-terv.md`-ben lefektetett formátumot követi.

---

## 1. Csomagstruktúra: `packages/rag`

A `dontesek-hf3.md` 8. pontja szerint a chunking/ingest kód önálló Nx-csomagba
kerül, a `packages/core` (agent-loop, futásidejű toolok) és a `packages/db`
(Prisma séma/migráció, a read-write kapcsolat gazdája) mellé, azokkal
egyenrangúan.

```
packages/rag/
├── src/
│   ├── parsing/
│   │   ├── parse-article.ts        # front matter (title/source/category) + törzs szétválasztása
│   │   └── parse-article.spec.ts
│   ├── cleaning/
│   │   ├── strip-boilerplate.ts    # "Perfect Pairings", "Words By The Sill" lábléc kivágása
│   │   └── strip-boilerplate.spec.ts
│   ├── chunking/
│   │   ├── chunk-article.ts        # fő belépési pont: cikk → Chunk[]
│   │   ├── chunk-article.spec.ts
│   │   ├── is-independent-list.ts  # a szabály-alapú listicle-heurisztika (ld. 3. pont)
│   │   └── is-independent-list.spec.ts
│   ├── embedding/
│   │   ├── cohere-embed-client.ts  # megosztott Cohere embed-hívás — packages/core is importálja
│   │   └── cohere-embed-client.spec.ts
│   ├── storage/
│   │   ├── write-knowledge-chunks.ts   # Prisma-n (DATABASE_URL, read-write) ír
│   │   └── write-knowledge-chunks.spec.ts
│   ├── ingest/
│   │   └── run-ingest.ts           # orchestrátor: a fenti lépések összefűzése, CLI-belépési pont
│   └── index.ts                    # publikus API: amit packages/core importál (embed client, típusok)
└── package.json
```

Ez pontosan az `implementacios-terv.md`/`konvenciok.md`-ben lefektetett elvet
követi: minden fogalom (parsing, cleaning, chunking, embedding, storage) saját
könyvtárat kap a teljes felszerelésével (implementáció + teszt egy helyen); az
`ingest/run-ingest.ts` fűzi ezeket egy batch-jobbá. Nincs központi
dispatch-registry — az orchestrátor egyszerűen sorban hívja a lépéseket.

**Miért nem a `packages/core`-ba kerül a keresési (retrieval) logika is?**
Nem — a `packages/rag` csak az **ingest** oldalt adja (batch job, egyszer fut
le a 202 cikken). A HyDE, a rerank és a végső válaszgenerálás továbbra is a
`packages/core`-ban él, egy új tool formájában (ld. 5. pont) — ugyanaz az elv,
mint a meglévő `runSql`/`listCategories` toolok: a `packages/core` felelőssége
a *futásidejű* agent-interakció, nem a batch-feldolgozás.

---

## 2. Adatbázis-séma bővítés: `knowledge_chunks` + pgvector

A HF3 pgvectort ajánlja a vektor-tároláshoz, és a projekt már Postgres-t
használ — ez a legkisebb új mozgó alkatrész, nincs indoka mást választani.

A séma **a `packages/db`-ben** bővül (Prisma), mert a `packages/db` a
read-write kapcsolat és a séma/migráció gazdája (`architektura.md` #2, #6) —
ez a döntés csak kiterjeszti ezt az elvet a chunk-táblára, nem tér el tőle:

```prisma
// packages/db/prisma/schema.prisma bővítése

datasource db {
  provider   = "postgresql"
  extensions = [vector]
}

generator client {
  provider        = "prisma-client-js"
  engineType      = "library"
  output          = "../generated/client"
  previewFeatures = ["postgresqlExtensions"]
}

model KnowledgeChunk {
  id          Int      @id @default(autoincrement())
  articleSlug String   @map("article_slug")   // pl. "ask-the-sill__best-floor-planter"
  title       String                           // grounding: cikk cím
  source      String                           // grounding: URL
  sectionPath String?  @map("section_path")    // szülő-alcím(ek), kontextusként a chunk mellett
  content     String
  contentHash String   @map("content_hash")    // előretekintés: docs/ARCHITEKTURA.md incrementális re-ingestjéhez
  embedding   Unsupported("vector(1536)")
  createdAt   DateTime @default(now()) @map("created_at")

  @@map("knowledge_chunks")
  @@index([articleSlug])
}
```

- `vector(1536)`: a Cohere `embed-v4.0` (ld. 4. pont — a modellnév a build
  közben, Context7-tel ellenőrzött, akkor aktuális névre frissült, az eredeti
  `embed-multilingual-v3.0` tervet felülírva) alapértelmezett dimenziója. A
  telepített `cohere-ai` SDK `EmbedRequest` típusában NINCS dimenzió-override
  mező (ellenőrizve a `node_modules`-ban), tehát a tényleges méret az API
  szerver-oldali alapértelmezése — ezt eredetileg feltételezésként vettük
  fel (nem volt érvényes `COHERE_API_KEY` az implementáció idején), majd
  **valós `embedTexts(...)` hívással megerősítettük: 1536**, pontosan
  egyezik az oszlop méretével, migráció nem szükséges.
- `contentHash`: most még nincs mögötte logika (a HF3 5. pontja szerint az
  inkrementális frissítés csak `docs/ARCHITEKTURA.md`-ben terv, nem kód) — de
  a mező felvétele most nulla költség, és előkészíti azt a történetet.
- Prisma natívan nem tud vektor-hasonlósági lekérdezést építeni, ÉS — ez R3
  közben derült ki — a schema-diffelője az `Unsupported(...)` string
  TARTALMÁNAK változását sem ismeri fel (`vector(1024)` → `vector(1536)`
  átírásra `prisma migrate dev` "Already in sync"-et jelentett, semmit nem
  generált). Emiatt a `knowledge_chunks` tábla teljes olvasás/írás útja —
  nemcsak a keresés (ld. 5. pont) — nyers SQL-lel megy, sosem a Prisma
  Client API-ján keresztül: a `packages/rag`-ben egy `pg` `Pool` a
  DATABASE_URL ellen (`write-knowledge-chunks.ts`), tükrözve a
  `readonly-db-client.ts` mintáját. A Prisma marad a séma/migráció
  tulajdonosa (`prisma/schema.prisma`), de a `KnowledgeChunk` táblát
  ténylegesen sosem a generált klienssel érjük el. Az `Unsupported`
  típusú oszlop dimenzió-változtatása is csak kézzel írt
  migration.sql-lel + `prisma migrate resolve --applied` jelöléssel
  ment végig (a diffelő ezt sem generálja le automatikusan).
- A pgvector kiterjesztéshez a `docker-compose.yml` image-e
  `postgres:16`-ról `pgvector/pgvector:pg16`-ra váltott (drop-in csere,
  ugyanaz a Postgres, a meglévő named volume/adat megmaradt).

---

## 3. Chunking-heurisztika (összegzés, kódszintre konkretizálva)

A `dontesek-hf3.md` 1–7. pontjában lefektetett elveket a `chunking/`
könyvtár így implementálja:

1. **`strip-boilerplate.ts`** — regex/string-alapú, cikkszintű zajszűrés
   *chunkolás előtt*: kivágja a `## Perfect Pairings For Your Plants` blokkot
   és a `##### Words By The Sill` lábléc-szakaszt (2. pont).
2. **`chunk-article.ts`** — a szerző saját Markdown-alcímei (`#####`, `###`)
   mentén vág szekciókat; minden szekció egy chunk-jelölt (3. pont).
3. **`is-independent-list.ts`** — a szabály-alapú heurisztika, ami eldönti,
   egy alcím alatti számozott/bullet lista **összefüggő** (egyben marad) vagy
   **független elemekből álló** (elemenként külön chunk, a szekció-cím
   kontextusként hozzáfűzve minden elemhez — 4–5. pont). Konkrét szabály
   (döntés a jelen tervezés során, ld. beszélgetés):
   - a lista minden eleme hasonló hosszúságú ÉS vastagon szedett
     névvel/tulajdonnévvel kezdődik, VAGY
   - a cikk címe/az alcím "N legjobb / top N" mintát követ (pl. `10 Best`,
     `N Beginner-Friendly`)
   → **független** (szétbontjuk). Ellenkező esetben **összefüggő** (egyben
   tartjuk). Ez a szabály tisztán determinisztikus, függvényhívásból hozott
   döntés — nincs benne modellhívás (ld. az alábbi indoklást).
4. Ha egy alcím alatt **minden** elem saját, valódi Markdown-alcímet kap
   (Minta E, FAQ-blokk) → a 2. lépés (alcím-vágás) önmagában helyesen
   szétbontja, az `is-independent-list.ts` ilyenkor nem is fut le rá (7. pont).
5. Minden végleges chunk mellé megy: `title`, `source`, `sectionPath` — ez
   fedi le a grounding és a kontextus-megőrzés követelményét.

**Miért szabály-alapú, nem kis LLM-hívás (a `dontesek-hf3.md` 6. pontjában
nyitva hagyott kérdés lezárása):** a HF3 explicit követelménye, hogy *"a
chunkolás determinisztikus → tesztelhető"* legyen, legalább pár unit teszttel.
Egy LLM-hívás a chunkolás közepén ezt megtörné: a kimenet hívásonként
változhat, a unit teszt vagy mockolná a hívást (ami nem a valós viselkedést
tesztelné), vagy maga a teszt válna instabillá. A szabály-alapú heurisztika
100%-ban determinisztikus, és pont a már beazonosított 5 minta-cikken
(Minta A–E) írható rá unit teszt — ezek adják a chunking teszt-suite gerincét.

---

## 4. Multi-provider routing

| Szerep | Provider / modell | Indoklás |
|---|---|---|
| HyDE-generálás (hipotetikus válasz-bekezdés a query-ből) | Anthropic, `claude-haiku-4-5` | Már bekötött provider (nincs új integráció), és a HyDE egy olcsó, gyors, "belső" generálási lépés — nem a felhasználó felé menő válasz, nem indokolt rá a drágább modell. |
| Embedding (chunk + query) | Cohere, `embed-v4.0` (R3-ban Context7-tel megerősített, aktuális modellnév — az eredetileg tervezett `embed-multilingual-v3.0`-t váltja) | Dedikált embedding-modell jobb retrieval-minőséget ad, mint egy általános LLM embeddingként használva; multilingual, mert a query magyar, a korpusz angol (ld. 6. pont). |
| Rerank | Cohere, `rerank-v4.0-pro` (Context7-tel megerősített, aktuális modellnév) | A Cohere Rerank gyakorlatilag referencia-termék erre a lépésre; ugyanaz a provider adja az embedet és a reranket, egy API-kulccsal — nem szaporítjuk a providerek számát a minimumon (2) felül feleslegesen. |
| Végső válaszgenerálás (grounding) | Anthropic, `claude-sonnet-5` | Ez már a meglévő `askAgent` modellje — a RAG-tool csak egy újabb tool a már működő loopban, nem cserél modellt a válaszadási lépésen. |

**Szereposztás egy mondatban:** *generálás → Claude (már bekötött, a
felhasználó felé menő szöveg minősége itt számít), retrieval-matek →
Cohere (dedikált embed/rerank modellek, ami erre a feladatra jobb, mint egy
általános LLM)* — ez a HF3 által kért indoklás a routing-döntésekhez.

---

## 5. Keresési pipeline — integráció a meglévő agentbe

Új tool a `packages/core`-ban, a meglévő `runSql`/`listCategories` mintáját
követve:

```
packages/core/src/tools/search-knowledge/
├── search-knowledge-schema.ts   # Zod input: { query: string }
├── search-knowledge-tool.ts     # a lépések összefűzése (lásd lent)
└── search-knowledge-tool.spec.ts
```

Lépések egy `search-knowledge` tool-hívásban:

1. **HyDE** — Claude Haiku egy rövid, angol nyelvű, hipotetikus válasz-bekezdést
   generál a (magyar) `query`-ből, a korpusz (The Sill blog) stílusát utánozva.
2. **Embed** — a HyDE-bekezdést a `packages/rag`-ből importált, megosztott
   `cohere-embed-client.ts`-szel embedeljük (**ugyanaz a kliens/modell, mint
   ingestkor** — ez korrektségi kérdés, nem csak DRY: a query- és
   dokumentum-vektoroknak ugyanabban a térben kell lenniük).
3. **Vektor-keresés** — a `readonly-db-client.ts`-en (DATABASE_URL_READONLY)
   keresztül, nyers SQL-lel (`ORDER BY embedding <=> $1 LIMIT 20`), a top-20
   legközelebbi chunk lekérése. *(A `runReadonlyQuery` jelenleg csak
   paraméter nélküli SQL-t fogad — ezt egy paraméterezett változattal kell
   bővíteni, hogy a vektort biztonságosan, nem string-konkatenációval lehessen
   átadni — `konvenciok.md` "Biztonság".)*
4. **Rerank** — a 20 jelöltet Cohere Rerank újrarendezi az eredeti (magyar)
   `query` ellenében (a Cohere rerank multilingual modellje kereszt-nyelvi
   scoringot is tud), és megtartjuk a top-5-öt.
5. **Grounding** — a top-5 chunk (tartalom + `title` + `source`) megy vissza
   `tool_result`-ként az agent-loopba; az `askAgent` system promptja (a
   meglévő `docs/system-prompt.md`/`ask-agent-prompt.ts` mintájára bővítve)
   előírja: a végső válasz forráshivatkozással jöjjön, és ha a top-5 nem
   releváns, az agent mondja ki, hogy nincs a tudásbázisban válasz (negatív
   teszt — HF3 4. pont).

**Top-K paraméterek indoklása:** 202 cikk, becsülhetően cikkenként néhány
chunk (a heurisztika alapján 3–8 db) → nagyságrendileg 800–1500 chunk
összesen. Egy 20-as előszűrési ablak bőkezű ehhez a korpuszmérethez (nem
vágja le idő előtt a releváns találatot), ugyanakkor egy Cohere rerank-hívás
20 dokumentumra még olcsó és gyors. Végső top-5 elég kontextust ad a
válaszhoz anélkül, hogy irreleváns chunkokkal hígítaná.

---

## 6. Nyelvi routing (magyar kérdés/válasz vs. angol korpusz)

A `data/knowledge/*.md` cikkek angolul vannak (The Sill blog), a Plantbase
agent viszont magyarul válaszol (`CLAUDE.md`, `system-prompt.md`). Döntés: a
HyDE-lépés **angolul** generálja a hipotetikus bekezdést (a korpusz
nyelvén/stílusában), a végső válasz marad **magyar** (a Claude
válaszgenerálási lépés fordítja/foglalja össze a talált angol tartalmat).

Ennek egy hasznos mellékhatása van a HF3 4. pontjának (golden set, nyers vs.
teljes pipeline összevetés) teljesítéséhez: a *nyers vektorkeresés* baseline
(csak embedding + távolság, HyDE nélkül) a **magyar** query-t embedeli
közvetlenül — ez a multilingual embedding modell mellett is gyengébb
egyezést ad, mint az angol HyDE-bekezdés. Ez konkrét, bemutatható különbség
lesz a golden set táblázatban: nem csak a rerank, hanem már a HyDE is
látványosan javítja a találatokat egy kereszt-nyelvi tudásbázison — ez a
tényleges, saját tudásbázisból következő indoklás, amit a HF3 elvár.

---

## 7. Tesztelési terv

- **Unit tesztek (`packages/rag`)**: `strip-boilerplate`, `chunk-article`,
  `is-independent-list` — a már beazonosított Minta A–E cikkeken (ld.
  `dontesek-hf3.md`), determinisztikus, mockolás nélkül (`konvenciok.md`
  "Tesztelés": determinisztikus, izolált tesztek).
- **`search-knowledge-tool` teszt (`packages/core`)**: a Cohere/Anthropic
  hívások mockolva (ez már *nem* a chunking-determinizmus alá esik, ez egy
  külső API-integráció, a meglévő `run-sql-tool.spec.ts` mintáját követve).
- **Golden set + negatív teszt**: külön, végrehajtási fázisban készül (5–10
  kérdés a saját domainből, nyers vs. teljes pipeline összevetés táblázatban,
  + legalább egy kérdés, amire nincs válasz a tudásbázisban) — ez már nem
  architektúra-döntés, hanem a HF3 4. pontjának konkrét leadandója.

---

## 8. Fázisolt implementációs terv

**R1 — `packages/rag` scaffold + parsing/cleaning**
Nx lib létrehozása, `parse-article.ts` + `strip-boilerplate.ts` a Minta A–E
cikkeken tesztelve.
*Teszt:* unit tesztek zöldek az 5 minta-cikken.
*Commit:* `feat(rag): scaffold packages/rag with article parsing and boilerplate stripping`

**R2 — Chunking**
`chunk-article.ts` + `is-independent-list.ts`, a 3. pontban leírt szabállyal.
*Teszt:* unit tesztek minden mintára (A–E), beleértve a listicle vs.
lépéssor megkülönböztetést.
*Commit:* `feat(rag): add heading- and list-aware chunking`

**R3 — Séma bővítés + embedding + storage**
`packages/db` séma bővítése (`KnowledgeChunk`, pgvector extension,
migráció), `cohere-embed-client.ts`, `write-knowledge-chunks.ts`.
*Teszt:* migráció lefut, egy próba-chunk embeddel+beírással végigmegy.
*Commit:* `feat(db,rag): add knowledge_chunks schema and embedding storage`

**R4 — `run-ingest.ts` — teljes batch**
A 202 cikk végigfuttatása; futtatási parancs dokumentálva a READMÉ-ben.
*Teszt:* `knowledge_chunks` sorszáma nagyságrendileg helyes, néhány sor
kézzel átnézve értelmes (title/source/content/sectionPath kitöltve).
*Commit:* `feat(rag): add full ingest run over the 202 articles`

**R5 — `search-knowledge` tool + agent-integráció**
HyDE → embed → vektor-keresés → rerank → grounding, bekötve az `askAgent`
toolsetjébe; system prompt bővítése grounding/negatív-válasz szabállyal.
*Teszt:* egy valós kérdésre forráshivatkozásos, magyar válasz jön; egy
tudásbázisban nem szereplő kérdésre az agent kimondja, hogy nincs találat.
*Commit:* `feat(core): add search-knowledge tool with hyde+rerank retrieval`

**Mérföldkő:** működő RAG-pipeline. Innentől a hátralévő HF3-leadandók
(golden set + negatív teszt dokumentálása, `docs/ARCHITEKTURA.md` + ábra,
költségbecslés a READMÉ-ben) végrehajtási munka, nem architektúra-döntés —
külön tervezés nélkül indíthatók.

## Hatókörön kívül (ebben a tervben nem szerepel)

- `docs/ARCHITEKTURA.md` tartalma (inkrementális frissítés terve, ábra) —
  külön deliverable, csak terv, nem kód (HF3 5. pont).
- Golden set konkrét kérdései és a nyers-vs-teljes összevetés táblázata —
  végrehajtási fázis, R5 után.
- Költségbecslés konkrét számai — csak a tényleges ingest+lekérdezés
  lefuttatása után mérhető valós adat, nem tervezhető előre.
