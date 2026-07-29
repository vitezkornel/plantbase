# Architektúra-terv: a tudásbázis karbantartása (HF3, 5. pont)

> **Ez csak terv, nem implementáció** (a HF3 explicit kéri: "Ezt NEM kell
> leimplementálni"). A `packages/rag` jelenlegi ingest-je (R1–R4) mindig a
> TELJES korpuszt dolgozza fel újra — ez a 202 cikkes méretnél elfogadható
> (ld. `rag-proposal.md`, költségbecslés). Ez a dokumentum azt írja le,
> hogyan váltanánk **inkrementális** frissítésre, ha a forrás rendszeresen
> változna.
>
> *(Névjegyzet: a HF3 leírása `docs/ARCHITEKTURA.md` néven kéri ezt a
> dokumentumot; a repó Windows-checkoutján ez ütközne a már meglévő,
> kód-kommentekben sokfelé hivatkozott `docs/architektura.md`-val — a két
> név egy kis-nagybetű-érzéketlen fájlrendszeren ugyanarra a fájlra mutat.
> A felhasználóval egyeztetve ez a dokumentum `architektura-hf3.md` néven
> él, a meglévő `architektura.md` (Nx monorepo szerkezet/döntések)
> tartalma és az arra mutató kód-kommentek változatlanok maradtak.)*

## A probléma

A `data/knowledge/*.md` cikkek egy külső blog (The Sill) pillanatnyi
állapotát tükrözik. Ha a forrás holnap ír egy új cikket, átír egy régit,
vagy töröl egyet, a mi `knowledge_chunks` táblánk ettől még a **tegnapi
igazságot** mondja — amíg újra le nem futtatjuk az ingest-et. A teljes
újrafuttatás a mi méretünknél (202 cikk) még olcsó és gyors, de ez a terv
azt mutatja be, hogyan skálázódna ez nagyobb, gyakrabban változó
korpusznál.

## Architektúra-ábra: a teljes adatfolyam

![A tudásbázis inkrementális frissítésének adatfolyama: forrás-fájlok →
hash-számítás → egyezés-ellenőrzés a knowledge_sources nyilvántartó
táblával → kihagyás / új-vagy-módosult ág (utóbbinál a régi chunkok
törlése, majd parse → clean → chunk → embed → beírás), valamint a törölt
dokumentum fordított-irányú
észlelése.](architektura-hf3-abra.jpg)

Az ábra a lenti 1–6. pontban részletezett logikát fedi le vizuálisan:
a bal oldali ág a hash-összevetést és az elágazást (kihagyás / új /
módosult) mutatja, a jobb oldali ág a törölt dokumentum fordított
ellenőrzését, alul pedig a meglévő (R1–R3) parse→clean→chunk→embed
pipeline és a tárolás lépése.

## 1. Változás-érzékelés

Minden forrás-cikkhez tárolunk egy **tartalmi ujjlenyomatot** (hash — pl.
SHA-256 a nyers, normalizált cikkszövegen), egy külön, kis
**nyilvántartó táblában**:

```prisma
model KnowledgeSource {
  articleSlug    String   @id @map("article_slug")
  contentHash    String   @map("content_hash")
  lastIngestedAt DateTime @map("last_ingested_at")

  @@map("knowledge_sources")
}
```

*(Megjegyzés: a jelenlegi `KnowledgeChunk` séma már tartalmaz egy
`contentHash` mezőt chunk-szinten — ez a terv egy CIKK-szintű hash-t
javasol emellé/helyette a nyilvántartó táblában, mert egy cikk
tartalmi módosítása gyakran megváltoztatja a chunk-határokat is, tehát
a "melyik konkrét chunk változott" kérdés bonyolultabb, mint a "melyik
CIKK változott" kérdés — utóbbi elég a döntéshez.)*

Minden ingest-futtatáskor:
1. Végigmegyünk a `data/knowledge/` fájljain, mindegyikhez kiszámoljuk
   az aktuális hash-t.
2. Összevetjük a `knowledge_sources` táblában tárolt hash-sel.
3. **Ha egyezik** → a cikket teljesen KIHAGYJUK (nincs újra-parse,
   újra-chunkolás, újra-embedding-hívás) — ez takarítja meg a felesleges
   Cohere-hívást (ld. költségbecslés) a változatlan cikkeken.

## 2. Új dokumentum

Ha egy fájlhoz **nincs** sor a `knowledge_sources` táblában → új
dokumentum. Teljes feldolgozás fut le rá (parse → tisztítás → chunkolás
→ embedding → beírás a `knowledge_chunks`-ba), majd egy új sor kerül a
`knowledge_sources`-be a friss hash-sel.

## 3. Módosult dokumentum

Ha a fájl hash-e ELTÉR a tárolt értéktől → a teljes cikket újrafeldolgozzuk.
**Nem próbálunk chunk-szintű "diffelést"** (megállapítani, melyik chunk
változott konkrétan) — ehelyett:
1. Töröljük a cikkhez tartozó ÖSSZES meglévő chunkot
   (`DELETE FROM knowledge_chunks WHERE article_slug = ...`),
2. újra lefuttatjuk rá a teljes pipeline-t,
3. frissítjük a `knowledge_sources` hash-ét és időbélyegét.

*Indoklás az egyszerűsítésre:* a chunk-határok a tartalom módosulásával
könnyen eltolódhatnak (pl. egy új bekezdés beszúrása arrébb tolja az
összes utána következő alcím tartalmát) — a "teljes csere" garantáltan
konzisztens állapotot ad, a bonyolultabb diff-alapú frissítés a
korpuszunk méreténél (202 cikk, cikkenként átlag ~7-8 chunk) nem éri meg
a hozzáadott komplexitást.

## 4. Törölt dokumentum

Fordított irányú ellenőrzés: minden `knowledge_sources`-beli
`articleSlug`-ra megnézzük, van-e még hozzá tartozó fájl a
`data/knowledge/`-ban. Ha **nincs**:
1. Töröljük a cikkhez tartozó összes chunkot a `knowledge_chunks`-ból,
2. töröljük a sort a `knowledge_sources`-ből is.

Ez akadályozza meg, hogy egy régen törölt cikk tartalma "kísértetként"
tovább éljen a keresési találatok között.

## 5. Mikor/mi triggereli az újraindexelést

**A jelen méretnél (202 cikk, egyetlen tartalom-forrás, nem élő feed):**
kézi trigger elegendő — ugyanaz a parancs (`pnpm --filter rag run
ingest`), amit most is használunk, csak a fenti hash-alapú
kihagyás-logikával kiegészítve, így egy újrafuttatás a gyakorlatban
"ingyenes" a változatlan cikkeken.

**Ha a forrás élő, gyakran változó feed lenne** (pl. napi frissülő
webshop-katalógus vagy hír-oldal), a triggerelés lehetséges irányai,
amiket ÉRDEMES lenne megfontolni, de ez a projekt jelenlegi méreténél
túlbonyolítás lenne:
- **ütemezett job** (pl. napi cron / GitHub Actions scheduled workflow),
  ami lefuttatja az ingest-et a hash-ellenőrzéssel;
- **webhook-alapú trigger**, ha a forrás támogat értesítést tartalom-
  változásról (pl. CMS webhook);
- **manuális, de dokumentált parancs** — ha a tartalom-gazda tudja, hogy
  mikor publikált újat, egy egyszerű, jól dokumentált parancs is
  elegendő lehet, automatizmus nélkül.

## 6. Idempotencia és biztonság

A fenti terv miatt az ingest **idempotens**: akárhányszor futtatjuk
egymás után, változatlan forrás mellett nem történik felesleges
API-hívás vagy adatbázis-írás. Egy megszakadt/hibázó futtatás
biztonságosan újraindítható — a már feldolgozott (és hash-ben rögzített)
cikkeket nem dolgozza fel újra, csak a hátralévőket.

## 7. Architektúra-ábra

Ld. a dokumentum elején, "A probléma" szakasz után: `architektura-hf3-abra.jpg`
(draw.io export).
