# HF3 — Döntési napló (RAG a Plantbase-en)

Ez a dokumentum a HF3 közben hozott egyedi döntéseket, indoklásokat gyűjti,
hogy a végleges leadásban (README, docs/ARCHITEKTURA.md, chunking-indoklás)
könnyen fel tudjuk használni.

---

## 1. Cikkek forrás-szerkezete (`seed/knowledge/*.md`)

**Megfigyelés:** a cikkek Markdown front matterrel kezdődnek:
```
---
title: ...
source: https://www.thesill.com/...
category: ask-the-sill
---
```
majd a tényleges cikktörzs következik.

**Döntés:** a `title` és `source` mezőket kötelezően eltároljuk minden
chunk mellett (nem csak a szövegbe ágyazva) — ez adja a grounding
forráshivatkozását (cikk cím + URL).

---

## 2. Szemét-szűrés a chunkolás ELŐTT

**Megfigyelés (ask-the-sill kategóriájú cikk mintáján):**
- A cikkek tartalmaznak egy `## Perfect Pairings For Your Plants` jellegű
  terméklistát (árak, "Best Seller" címkék) — ez marketing tartalom, nem
  gondozási tudás.
- A cikkek végén egy visszatérő lábléc-szöveg van (`##### Words By The Sill`
  és utána mindig ugyanaz/hasonló szöveg) — ez cégleírás, nem cikk-specifikus
  tartalom.

**Probléma, ha nem szűrjük:**
- A lábléc szinte azonos szövegként ~202-szer bekerülne a tudásbázisba →
  zajt visz a vektortérbe, feleslegesen versenyezhet a top-K találatok
  helyéért.
- A termékajánló blokk félrevezetheti az ártal/termékkel kapcsolatos
  kérdéseket (ez amúgy is a `products` tábla / `runSql` dolga, nem a
  tudásbázisé).

**Döntés:** ingest előtt egy tisztító (cleanup) lépés vágja ki ezeket a
visszatérő, nem-tartalmi szekciókat, mielőtt a chunkolás megtörténne.
*(Indoklás a HF3 chunking-leírásba: "az órai naiv bekezdés-pakolás ezt nem
venné észre, mi igen, mert megnéztük a valódi cikk-szerkezetet.")*

**Nyitott kérdés / még ellenőrizendő:** más `category` értékű cikkeknél
(nem csak `ask-the-sill`) ugyanez a szerkezet érvényes-e, vagy vannak
másfajta felépítésű cikkek is (pl. hosszabb, alcímes gondozási útmutatók)?
→ ez határozza meg, kell-e kategória-specifikus chunking-logika.

---

## 3. Kétféle cikk-szerkezet azonosítva

**Minta A — `ask-the-sill` kategória** (pl. "Best Light-Weight Floor Planter"):
rövid, Q&A jellegű, alig van belső alcím-tagolás, egybefüggő válasz.

**Minta B — `care-miscellaneous` kategória** (pl. "Grow Pot vs Planter"):
hosszú, több témát érintő útmutató, valódi `#####` alcím-tagolással
(pl. "Why some prefer nursery grow pots", "Steps to pot your plant"),
és tartalmaz egy számozott lépéssorozatot (6 lépés), ami logikailag
EGY egység, nem vágható szét.

**Probléma a naiv (órai) "bekezdéseket ~1000 karakterig pakold egymás
mellé" logikával:** ha a vágás pont egy számozott lista közepére esik
(mert ott éri el az 1000 karaktert), a chunk félbevágott, értelmetlen
instrukciót ad vissza egy keresésre (pl. csak a lépések fele jön vissza).

**Döntés:** a chunkolás elsődlegesen a szerző saját alcím-tagolása
(`#####`, `###` Markdown headerek) mentén történjen — egy chunk = egy
önálló témaegység a cikken belül, nem karakterszám-vezérelt vágás.
A karakterlimit csak MÁSODLAGOS szabály (ha egy alcím alatti szakasz
maga is túl hosszú, azon belül osztjuk tovább, de a listákat/lépéseket
nem vágjuk szét).
*(Indoklás a HF3-ba: "a tagolást a szerző már megcsinálta helyettünk,
mi csak tiszteletben tartjuk" — ez az órai elv, amit itt ténylegesen
alkalmazni is tudunk, mert a forrás ezt lehetővé teszi.)*

**Megerősítés a szemét-szűréshez (ld. 2. pont):** a "Perfect Pairings"
termékblokk és a "Words By The Sill" lábléc MOST MÁR KÉT különböző
kategóriájú cikkben is előfordul azonos formában → megalapozott az
általános (nem kategória-specifikus) szűrési szabály.

**Nyitott kérdés:** van-e a 202 cikk között olyan kategória is, ami
se nem Q&A, se nem hosszú útmutató (pl. terméklista-jellegű vagy
listicle cikk)? Érdemes még 1-2 további kategóriát megnézni, mielőtt
lezárjuk a chunking-logikát.

---

## 4. Harmadik cikk-szerkezet: listicle (független listaelemek)

**Minta C — `outdoor-plant-care` kategória** (pl. "10 Best Plants for
Beginner Gardeners"): egy "top-10" jellegű cikk, `##### 10
Beginner-Friendly Plants` alcím alatt 10 számozott bekezdés, DE
mindegyik egy MÁSIK, egymástól FÜGGETLEN növényről szól.

**Kritikus felismerés — ez élesen szembemegy a Minta B (3. pont)
"listát ne vágd szét" szabályával, ha azt szó szerint, mindenre
alkalmaznánk:**
- Mintánál B (lépéssorozat, "Steps to pot your plant"): a lista elemei
  EGYMÁSRA ÉPÜLNEK (folyamat) → szétvágva értelmetlen → EGYBEN tartandó.
- Itt (Minta C, listicle): a lista elemei EGYMÁSTÓL FÜGGETLENEK (10 db
  külön növény) → ha egyben tartjuk, egyetlen vektor próbálna 10
  különböző jelentést hordozni ("egy vektor egy jelentést hordoz" —
  6. óra elve) → egy konkrét kérdésre (pl. "milyen rózsát ajánlotok
  kezdőknek") a keresés csak egy elmosott, 10 növényt kevergető
  találatot adna vissza.

**Döntés (finomítva a 3. ponthoz képest):** a chunkoló logikának külön
kell kezelnie a listákat aszerint, hogy EGYMÁSRA ÉPÜLŐ folyamat-e
(→ egyben tartjuk) vagy FÜGGETLEN, katalógus-jellegű felsorolás-e
(→ minden elem külön chunk). Ez nem tisztán a Markdown-struktúrából
(pl. "van-e számozás") dönthető el gépiesen, kell hozzá egy egyszerű
heurisztika vagy szabály (pl.: ha minden listaelem saját, jól
elkülöníthető alcímmel / vastagon szedett névvel kezdődik és a
cikk címe "N legjobb / N best" mintát követ → listicle → szétbontjuk).

**Extra észrevétel:** az `##### At a Glance` bullet-összefoglaló (a
cikk elején, 4 rövid pont) önálló, jó minőségű chunk-jelölt: egy
általános, bevezető jellegű kérdésre ez pontosabb találat lehet, mint
bármelyik konkrét növény-bekezdés.

---

## 5. Negyedik cikk-minta: vegyes cikk (fogalom-magyarázat + beágyazott listicle)

**Minta D — `plants-101` kategória** (pl. "Easy Indoor Plants That Can
Survive Low Light"): a cikk ELEJE ugyanolyan, mint a Minta B — önálló,
koherens `#####` fogalom-magyarázó szekciók ("What is a low light
plant?", "How do you care for low light plants?"). A cikk VÉGE viszont
egy beágyazott listicle: `##### What are some easy low light tolerant
plants?` alcím alatt 6 db számozott bekezdés, mindegyik EGY MÁSIK
növényről (Snake Plant, ZZ Plant, Philodendron, Pothos, stb.) — nincs
külön vastagított cím minden elem előtt, csak a bekezdés eleje maga a
"név", de a probléma ugyanaz, mint Minta C-nél: egymástól független
tartalmi egységek.

**Kulcs-felismerés — ÁLTALÁNOSÍTÁS:** ez bizonyítja, hogy a chunking
döntés NEM cikk-szintű ("ez a cikk X típusú"), hanem SZEKCIÓ-szintű.
Egyetlen cikken belül is keveredhet:
- koherens, önmagában összefüggő magyarázó szakasz → EGYBEN chunk,
- ugyanazon cikken belüli beágyazott, egymástól független elemekből
  álló felsorolás → ELEMENKÉNT külön chunk.

**Végleges chunking-szabály (összegzés a 3+4+5. pontokból):**
1. Elsődleges vágási pont: a szerző saját Markdown alcímei (`#####`,
   `###`) — minden alcím alatti szakasz egy jelölt egység.
2. Minden ilyen szakaszon belül eldöntjük: a szakasz egy összefüggő
   gondolat (folyamatleírás, magyarázat, Q&A-válasz), vagy egy
   egymástól független elemekből álló felsorolás (listicle, akár
   számozott, akár nem)?
   - Összefüggő → a teljes szakasz egy chunk (karakterlimit csak
     másodlagos, ha túl hosszú, azon belül tovább bontható, de a
     listát/lépéssort nem vágjuk szét).
   - Független elemek → minden elem saját chunk, a szekció címét
     (pl. "10 Beginner-Friendly Plants") kontextusként minden elemhez
     hozzáfűzzük, hogy a chunk önmagában is értelmezhető maradjon.
3. Cikkszintű zaj (termékajánló blokk, lábléc) mindig kiszűrve, a
   chunkolás előtt (ld. 2. pont).
4. Minden chunk mellé megy: `title`, `source` (grounding), és a
   közvetlen szülő-alcím szövege (kontextus).

**Konzultáció-jelölt Claude Code-nak:** ezt a heurisztikát (összefüggő
vs. független szakasz) egyszerű szabályokkal (pl. "számozott/bullet
lista + minden elem hasonló hosszú, hasonló felépítésű, más
tulajdonnévvel/tárggyal kezdődik" → független) vagy egy kis
LLM-hívással is el lehet dönteni ingest közben — ezt a build-tervben
tisztázni kell, melyik utat választjuk, és miért.

---

## 6. Döntés: hogyan konkretizáljuk az "összefüggő vs. független szakasz" heurisztikát

Két út közül választhattunk:
A) mi írjuk meg kézzel, előre, a pontos szabályt;
B) az elvet (5. pontban leírt szekció-szintű megkülönböztetés) adjuk
   oda Claude Code-nak a build-terv fázisában, és ő tegyen konkrét
   implementációs javaslatot (szabály-alapú heurisztika vagy kis
   LLM-hívás ingest közben), amit aztán közösen véglegesítünk.

**Döntés: B út.** Indoklás: ez apró, implementáció-közeli tervezési
kérdés, amit érdemesebb a kóddal együtt, plan módban kidolgozni (lát
rá a megvalósítás egyszerűségére/nehézségére), és a visszakérdezés +
döntés folyamata maga is jó alapanyag a végleges indokláshoz.
*(Ez a döntés maga is bekerül a HF3 chunking-indoklásba: miért nem mi
találtuk ki kézzel, hanem hogyan alakítottuk ki a heurisztikát.)*

---

## 7. Ötödik cikk-minta: mély, egy-növényes útmutató + beágyazott FAQ (saját alcímekkel)

**Minta E — `plants-101` kategória** (pl. "How To Care for a Meyer
Lemon"): a cikk eleje "At a Glance" kulcs-érték jellegű összefoglaló
(Sunlight / Water / Hardiness / Care Tip) — tömör, gyors-választ adó
blokk, jó önálló chunk. A törzs `#####` kérdés-alcímekkel tagolt
(Minta B mintájára). A végén egy `##### FAQ's` szekció, amiben MINDEN
EGYES kérdésnek SAJÁT `#####` alcíme van (pl. "*What is the difference
between a Meyer lemon bush and a Meyer lemon tree?*").

**Pontosítás a 6. pontban hozott döntéshez (heurisztika szükségessége):**
felismerés, hogy a "független listaelemek" probléma (Minta C, D) CSAK
akkor jelentkezik, ha a szerző NEM adott saját, valódi Markdown-alcímet
minden elemnek (pl. csak `**1. Japanese Maples**` vastagítás, nem
`#####` header). HA minden elem saját valódi alcímet kap (mint itt a
FAQ blokkban) → az 1-es alapszabály (vágás az alcímek mentén) ÖNMAGÁBAN
helyesen szétbontja az elemeket, NEM kell külön "összefüggő vs.
független" döntés.

**Ez leszűkíti, mikor kell egyáltalán lefuttatni a 6. pontban tervezett
heurisztikát:** csak azokra a szakaszokra, ahol egy alcím ALATT
számozott/bullet listaként, KÜLÖN ALCÍM NÉLKÜL sorakoznak egymástól
független tartalmi egységek. Ez egyszerűsíti a Claude Code-nak adott
specifikációt: a heurisztika csak egy szűk, jól körülhatárolható
esetre kell, nem minden szakaszra.

---

## 8. Döntés: a chunking/ingest kód önálló `packages/rag` Nx-csomagba kerül

**Döntés:** a chunking- és ingest-logika (cikk beolvasás, tisztítás, szekció-
szintű chunkolás, embedding, pgvector-be írás) egy önálló, új Nx-csomagba
kerül: `packages/rag`. NEM a `packages/core`-ba (az agent-csomag) és NEM a
`packages/db` mellé, hanem azzal egyenrangú, harmadik/negyedik csomagként.

**Indoklás:**
- A `packages/core` felelőssége az agent-loop és a toolok (`runSql`,
  `listCategories`) — ezek mind a *futásidejű* kérdés-válasz útra épülnek,
  read-only DB-kapcsolattal. A chunking/ingest egy teljesen más életciklusú,
  *batch* jellegű folyamat (egyszer lefut a 202 cikken, nem minden kérdésnél),
  saját függőségekkel (embedding-hívás, markdown-parsing, pgvector-írás).
  Ha ez a `core`-ba kerülne, a `core` felelőssége szétfolyna: futásidejű
  agent-logika és batch-ingest logika ugyanabban a csomagban élne, holott
  semmilyen kódot nem osztanak meg egymással.
- A `packages/db` felelőssége a read-write Prisma-séma/migráció/seed
  karbantartása — ez sem illik hozzá: az ingest nem sémamódosítás, hanem
  tartalom-feldolgozás és -betöltés, más absztrakciós szinten.
- Külön csomagban tartva a `packages/rag` önállóan buildelhető/tesztelhető
  (`pnpm nx test rag`), saját, jól körülhatárolható unit tesztkészlettel a
  chunking-heurisztikára (ld. 3–7. pont) — ez felel meg a HF3 elvárásának,
  hogy a chunkolás "determinisztikus → tesztelhető".
- A keresési pipeline (HyDE, rerank, retrieval) és a végső válaszgenerálás
  továbbra is a `packages/core`-ban él (az agent egy új toolként hívja meg
  a RAG-keresést) — a `packages/rag` csak az ingest/chunking oldalt adja,
  nem a futásidejű keresést. (Ezt a határvonalat a build-terv fázisában
  pontosítjuk: mi megy a `rag` csomagba mint publikus API, amit a `core`
  tool-ja importál.)

---

## 9. R2 közben felfedezett hiba a 6. pontban jóváhagyott heurisztikában — javítás

**Probléma:** a 6. pontban (és a tervezés során jóváhagyott) heurisztika —
"minden listaelem hasonló hosszú ÉS vastagon szedett névvel kezdődik VAGY a
cikk címe 'N legjobb/top N' mintát követ" — a `chunk-article.ts` tényleges
megírásakor megbukott a saját Minta B-nkön: a "Steps to pot your plant"
szekció (`care-miscellaneous__grow-pot.md`) IS bold-számozott elemekből áll
(`**1. Remove plant from nursery grow pot**`, ..., `**6. Water and
enjoy**`), hasonló hosszúságúak — a heurisztika szó szerint ezt is
"független listának" minősítette volna, holott ez pont az a lépéssor,
amit a 3. pont szerint EGYBEN kell tartani. A bold-formázás és a
hosszúság tehát NEM különbözteti meg a szekvenciális lépéssort a független
katalógustól — mindkettő ugyanúgy néz ki formailag.

**A tényleges megkülönböztető jel:** nem a lista ELEMEINEK formázása, hanem
a **szekció-cím szemantikája**:
- "Steps to pot your plant" — a cím maga procedurális ("steps", "how to"),
  egy adott növényre vonatkozó cselekvéssor → EGYBEN tartandó.
- "10 Beginner-Friendly Plants" / a cikk címe "10 Best Plants for Beginner
  Gardeners" — a cím számot + felsőfokot/kategória-többesszámot tartalmaz
  → független katalógus → SZÉTBONTANDÓ.
- "What are some easy low light tolerant plants?" (Minta D beágyazott
  listája) — kérdés-alakú cím, ami többesszámú kategórianévvel zárul
  ("...plants?") → szintén független katalógus → SZÉTBONTANDÓ.

**Javított döntés:** az `isIndependentList` heurisztika a **cikk címét és a
szekció-alcímet** vizsgálja (nem a lista-elemek formázását), ebben a
sorrendben:
1. Ha az alcím procedurális kulcsszót tartalmaz (`steps`, `how to`,
   `guide to`) → **összefüggő** (ez a legmagasabb bizalmú jel, elsőként
   ellenőrizzük).
2. Ha a cikk címe VAGY az alcím számot + felsőfok/kategória-szót tartalmaz
   (`best`, `top`, `beginner`, `favorite`) → **független**.
3. Ha az alcím kérdés-alakú és többesszámú főnévvel zárul ("what/which
   are some ... X-s?") → **független**.
4. Egyébként → **összefüggő** (biztonságos alapértelmezés — a legtöbb
   szekció ilyen).

**Extra egyszerűsítés, amit ez a felfedezés hozott:** az
`isIndependentList` hívása KIZÁRÓLAG számozott (`1.`/`**1.**`) listákra
történik, legalább 3 elemtől — a bullet-listákat (pl. Minta B "Why some
prefer..."/"When to consider..." indoklás-felsorolásai, vagy Minta C "At a
Glance" összefoglalója) sosem bontjuk elemenként, mindig egyben egy chunk
marad. Ez megfelel a korábbi megfigyelésnek (4. pont: az "At a Glance"
bullet-blokk önmagában jó, EGYBEN tartandó chunk-jelölt), és feleslegessé
teszi, hogy a heurisztikának egyáltalán foglalkoznia kelljen a
bullet-listákkal.

---

## 10. R2 elején felfedezett harmadik boilerplate-minta: "Ask The Sill" rovat-tagline

**Megfigyelés:** a `chunk-article.ts` tervezése közben (mielőtt a
heading-alapú vágást megírtam) végignéztem, mi történne egy valós
`ask-the-sill` kategóriájú cikken (Minta A) a vágás után. A cikk egy
`###### From flawlessly introducing a trendy plant to tackling windowless
room woes, our plant specialist Chrissy will set you up with the perfect
plant pick.` szövegű `######` (h6) sort tartalmaz, közvetlenül a cikk eleje
felé. Egy `grep` ellenőrzés (`grep -h "^######" data/knowledge/ask-the-sill__*.md`)
megmutatta, hogy ez a mondat — néhány apró szövegezési változattal (pl.
"our plant specialist Chrissy" vs. "plant enthusiast and customer happiness
team lead Chrissy") — **22 különböző `ask-the-sill` cikkben** ismétlődik
szinte szó szerint. Ez a "Rovat" (Ask The Sill oszlop) leíró mondata, nem az
adott cikk saját tartalma.

**Probléma, ha nem szűrjük:** a heading-alapú chunkolás (3. pont) minden
`######` sort saját szekció-határnak tekint — ha ez a tagline egyben marad
egy szekcióként, 22 különböző cikkben (majdnem) azonos szövegű, önálló
chunk keletkezne. Ez pontosan ugyanaz a vektortér-hígítási probléma, mint a
2. pontban leírt "Perfect Pairings"/"Words By The Sill" lábléc: cikk-
specifikus tartalom nélküli, ismétlődő zaj versenyezne a top-K találatok
helyéért.

**Fontos megkülönböztetés:** a többi `######` sor a korpuszban (nem
`ask-the-sill` kategóriában, illetve az `ask-the-sill` cikkek nagy részében
is) **valódi, cikk-specifikus, egyedi egy-mondatos összefoglaló** (pl. "Sure,
money doesn't grow on trees, but the Coin Plant... is worth spending some
time on."), NEM boilerplate — ezeket NEM szabad kiszűrni, sőt önmagukban jó
chunk-jelöltek (hasonlóan a "At a Glance" bullet-blokkhoz, 4. pont). Emiatt
nem lehet "minden `######` sort dobj el" szabályt írni; a szűrésnek
kifejezetten erre az egy, ismétlődő mondatra kell irányulnia.

**Döntés:** a `strip-boilerplate.ts`-t (R1-ben már megírt, ekkor
visszamenőlegesen kiegészített) egy második szabállyal bővítettem: bármely
sor, ami tartalmazza a mind a 22 változatban stabilan jelen lévő rész-
mondatot ("will set you up with the perfect plant pick"), kikerül — nem
egzakt string-egyezéssel (mert a pontos szöveg cikkenként kicsit eltér),
hanem ezzel a stabil alszöveg-illesztéssel. Unit teszttel lefedve mindkét
megfigyelt szövegváltozaton (`strip-boilerplate.spec.ts`).

---

## 11. R3 közben: `embed-multilingual-v3.0` → `embed-v4.0` váltás (Cohere embedding modell)

**Előzmény:** a tervezés (`rag-proposal.md` első verziója) még
`embed-multilingual-v3.0`-t irányzott elő embedding-modellként — ez volt a
Cohere multilingual embed-modellje a tervezés idején ismert információk
alapján.

**Mi történt R3-ban:** a `packages/rag/src/embedding/cohere-embed-client.ts`
tényleges megírása előtt, `architektura.md` #7 elve szerint ("Library-doksi
munka előtt ELŐBB beolvassuk a doksit Context7-tel"), lekérdeztem a Cohere
TypeScript SDK aktuális dokumentációját (`/cohere-ai/cohere-typescript`,
Context7-n keresztül) az embed-hívás pontos szintaxisára. **Minden egyes
visszaadott kódpélda és API-referencia kizárólag `embed-v4.0`-t használt
modellnévként** — az `embed-multilingual-v3.0` egyetlen aktuális
kódpéldában, referenciában vagy request-példában sem szerepelt.

**Döntés:** a tervben szereplő `embed-multilingual-v3.0`-t lecseréltem
`embed-v4.0`-ra. Indoklás: ez a Cohere SDK aktuálisan dokumentált,
referenciapéldákban következetesen használt embedding-modellje — a
korábbi terv egy, a tervezés idején ismert, de a build idejére már nem az
elsődlegesen dokumentált modellnévre épült. A modell multilingual
képessége (szükséges a magyar kérdés / angol korpusz keresztnyelvi
egyezéshez, ld. `rag-proposal.md` #6) a Cohere embed-modellcsalád v3 óta
adott tulajdonsága, ez a váltással nem veszett el — csak a konkrét
modell-verziónevet frissítettem az aktuálisan dokumentáltra.

**Utólagos megerősítés (R4 előtt, miután érvényes `COHERE_API_KEY` került
a `.env`-be):** egy valós `embedTexts(['test sentence for dimension
check'], 'search_document')` hívás 1536 elemű vektort adott vissza — a
feltételezés helyesnek bizonyult, a pgvector oszlop mérete (`vector(1536)`)
nem igényelt módosítást a teljes ingest előtt.

---

## (ide jönnek a következő döntések...)
