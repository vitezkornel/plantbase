# Plantbase

CLI AI agent, amely természetes nyelvű kérdést fordít SQL-re egy növény-katalógus (`products` tábla) felett, read-only lefuttatja, és a kapott sorokból érthető, magyar nyelvű választ ad — SQL-tudás nélkül is használható lakberendezőknek és otthoni felhasználóknak.

## Funkciók

- **Natural language → SQL** (`runSql` tool): a felhasználó szabad szöveges kérdését az agent SQL SELECT-té fordítja, lefuttatja, és a sorokból foglal össze választ.
- **Kategória-lekérdezés** (`listCategories` tool): a katalógusban ténylegesen előforduló kategóriákra rákérdező kérdéseket (pl. "milyen kategóriák vannak?") nem ad-hoc SQL-lel, hanem egy dedikált, fix lekérdezéssel szolgálja ki.
- **Interaktív és egyszeri `ask` parancs**: `ask "<kérdés>"` egyszeri lekérdezés, vagy `ask` argumentum nélkül interaktív readline-munkamenet (`exit`-ig).
- **Naplózás**: minden interakcióról egy `logs/*.jsonl` bejegyzés (system prompt, üzenetek, generált SQL, eredmény, token-használat); `--show-prompt` kapcsolóval a teljes system prompt + üzenet-tömb konzolra is kiírható.
- **Két biztonsági réteg**: alkalmazás-szintű SQL-guard (csak egyetlen SELECT/WITH statement, mutáló kulcsszavak és stacked statementek elutasítva) **és** egy Postgres `plantbase_readonly` role, ami DB-szinten is csak SELECT-et enged a `products` táblán — defense in depth.

## Előfeltételek

- Node.js (LTS), pnpm, Docker Desktop, `gh` CLI.
- Egy Anthropic API kulcs ([console.anthropic.com](https://console.anthropic.com/settings/keys)).

## Indítás lépésről lépésre

```bash
# 1. Függőségek telepítése
pnpm install

# 2. .env létrehozása és kitöltése (API kulcs, DB-kapcsolatok)
cp .env.example .env
# .env-ben: ANTHROPIC_API_KEY kitöltése; DATABASE_URL / DATABASE_URL_READONLY
# alapból a lenti compose-alapértékekre mutat, éles jelszóhoz módosítandó.

# 3. Postgres felhúzása
docker compose up -d

# 4. Read-only DB-role létrehozása (egyszeri lépés, idempotens)
docker exec -i plantbase-postgres psql -U plantbase -d plantbase \
  -v pw="$POSTGRES_READONLY_PASSWORD" -f /dev/stdin < packages/db/sql/create-readonly-role.sql

# 5. Prisma migráció + szintetikus seed (~30 növény)
pnpm --filter db exec prisma migrate deploy
pnpm --filter db exec prisma db seed

# 6. CLI build
pnpm nx build cli

# 7. Futtatás
node apps/cli/dist/main.js ask "Milyen kaktuszaitok vannak?"
# vagy interaktív módban:
node apps/cli/dist/main.js ask
```

## RAG-tudásbázis ingest (HF3, `packages/rag`)

A `data/knowledge/` alatti 202 gondozási cikk chunkolása + embeddelése +
pgvector-be írása egy külön batch-job, nem fut le automatikusan a fenti
lépésekkel. Lásd a teljes tervet: `docs/rag-proposal.md`.

```bash
# Előfeltétel: .env-ben COHERE_API_KEY kitöltve (https://dashboard.cohere.com/api-keys)
# és a 3-5. lépés (Postgres + migráció) már lefutott.

pnpm --filter rag run ingest
```

Ez valós Cohere API-hívásokat indít (kb. 202 hívás, cikkenként egy) —
költséggel jár, ld. a README költségbecslés-szakaszát (később).

**Státusz:** az ingest egyszer már lefutott a teljes korpuszon: 202 cikk,
1552 chunk a `knowledge_chunks` táblában (a beágyazás dimenziója valós
API-hívással megerősítve: 1536). Egy valós, végponttól-végpontig lekérdezés
(`searchKnowledge("Hogyan gondozzak egy Meyer citromfát?")`) helyesen az
5 legjobb találatot a "How To Care for a Meyer Lemon" cikk releváns
szekcióiból adta vissza, 0.87–0.93 relevancia-score-okkal.

## Architektúra

Nx monorepo (pnpm), négy projekt:

- **`packages/core`** — az agent-logika: `agents/ask-agent` (system prompt + agent-loop), `tools/run-sql` és `tools/list-categories` (a két, agentnek regisztrált tool), közös kód (`tool-outcome.ts`, `readonly-db-client.ts`) egy szinttel feljebb.
- **`packages/db`** — Prisma séma, migráció, seed; a **read-write** DB-kapcsolatot birtokolja (a `products` katalógus és a RAG `knowledge_chunks` táblája is itt kap sémát).
- **`packages/rag`** — a RAG-tudásbázis ingest-oldala: cikk-parsolás, boilerplate-szűrés, heading-alapú chunkolás, Cohere embedding, pgvector-írás. Lásd `docs/rag-proposal.md`.
- **`apps/cli`** — a parancssori felület (commander), csak I/O-réteg `packages/core` felett.

**Két DB-kapcsolat, két jog**: `DATABASE_URL` (read-write, Prisma migrate/seed, `packages/db`) és `DATABASE_URL_READONLY` (csak SELECT, a `plantbase_readonly` role-lal, közvetlen `pg` klienssel — NEM Prismán keresztül — az agent `runSql`/`listCategories` toolja ezt használja). A kettő szándékosan el van választva: az agentnek fizikailag nincs lehetősége írni az adatbázisba, még egy prompt-injection vagy guard-hiba esetén sem.

## Telepített pluginek/skillek

- **superpowers** — a TDD-munkamódszer (RED-GREEN-refactor) és a subagent-driven fejlesztési folyamat forrása; ezt ténylegesen alkalmaztuk minden implementációs lépésnél (A1-A5 környezet-lépések, B Fázis 1-3, majd a `listCategories` tool) — minden új viselkedés előbb egy bukó teszttel indult, csak utána jött a minimális implementáció.
- **commit-commands** — a git/commit workflow egységesítésére, hogy minden commit Conventional Commits formátumot kövessen, kis, fókuszált tartalommal.
- **skill-creator** — saját skillek létrehozásának lehetőségéhez, bár ebben a projektben elsősorban a superpowers beépített skilljeit használtuk, nem írtunk egyedi skillt.

## MCP-szerverek

- **github** — GitHub-műveletekhez (issue/PR-kezelés, repó-lekérdezés) a `gh` CLI mellett/helyett.
- **context7** — friss, verzió-pontos library-dokumentáció lekérdezése kódolás előtt (Nx, Prisma, Anthropic SDK, commander) a hallucináció csökkentésére.
- **postgres** — közvetlen, read-only rálátás a fejlesztői adatbázisra debug/ellenőrzés céljából.
- **prisma** — a Prisma-sémával/migrációkkal kapcsolatos műveletek segítése fejlesztés közben.

### Biztonsági javítás: MCP-konfiguráció titokkezelése

A projekt fejlesztése közben felmerült, hogy a `claude mcp add` parancs a Postgres MCP-szerver kapcsolati adatait (beleértve a `plantbase_readonly` szerepkör jelszavát) nyílt szövegként menti el a `.mcp.json` fájlba — ez a fájl alapból git által követett, tehát a jelszó bekerült volna a repóba.

Ez ellentmond a `konvenciok.md` explicit biztonsági szabályának ("Titkok env-ben, soha a repóba").

**Megoldás:** mivel a `.mcp.json` formátuma nem támogatja natívan a futásidejű környezeti változó-behelyettesítést (ellentétben pl. a docker-compose-zal), a következő megközelítést választottuk:

- a `.mcp.json` fájlt felvettük a `.gitignore`-ba (a `.env`-hez hasonlóan, ugyanazon elv alapján)

- létrehoztunk egy `.mcp.json.example` sablont, placeholder-jelszóval, hogy bárki, aki klónozza a repót, tudja, milyen struktúrájú fájlt kell létrehoznia magának

- a helyi, valódi `.mcp.json` a gépen marad, változatlan tartalommal, de soha nem kerül fel a GitHub-repóba

Ez ugyanazt a mintát követi, mint a `.env` / `.env.example` páros, konzisztens biztonsági megközelítést biztosítva a projekt egészében.

### Megjegyzés: alternatív, egyszerűbb megoldás

Utólag átgondolva, a `--scope local` használata (a `--scope project` helyett) a Postgres/Prisma MCP telepítésekor eleve elkerülte volna ezt a problémát: a `local` scope nem a projekt-mappában lévő, git által követett `.mcp.json`-ba, hanem a felhasználó saját, gépi Claude Code-konfigurációjába kerül, így sosem válna commitolhatóvá. Ezt a megoldást is megfontoltuk, de mivel a jelenlegi (project scope + .gitignore + .mcp.json.example) megközelítés is teljesen biztonságos és működő, és így más gépről/felhasználótól is könnyen reprodukálható a projekt beállítása, ezt tartottuk meg.

## További dokumentáció

- [`docs/roi.md`](docs/roi.md) — ROI-levezetés
- [`docs/system-prompt-javitas-indoklas.md`](docs/system-prompt-javitas-indoklas.md) — system prompt minőségi javításainak indoklása
- [`docs/implementacios-terv.md`](docs/implementacios-terv.md) — implementációs terv
- [`docs/brs-plantbase.md`](docs/brs-plantbase.md) — üzleti követelmények
- [`docs/stack.md`](docs/stack.md) — technológiai stack
- [`docs/architektura.md`](docs/architektura.md) — architektúra
- [`docs/konvenciok.md`](docs/konvenciok.md) — kódkonvenciók
- [`docs/dev-workflow.md`](docs/dev-workflow.md) — fejlesztői workflow
- [`docs/system-prompt.md`](docs/system-prompt.md) — az agent teljes system promptja

## Demo

```
$ node apps/cli/dist/main.js ask "Milyen kaktuszaitok vannak?"

Íme a jelenlegi kaktuszkínálatunk (mindegyik pet-safe, tehát háziállatoknak is biztonságos):

1. Aranygömb kaktusz (Echinocactus grusonii) – 3 990 Ft
   Direkt napfényt kedvel, ritkán öntözendő, kezdőknek is ideális
   18 db raktáron, ⭐4,5 (63 értékelés)

2. Karácsonyi kaktusz (Schlumbergera truncata) – 2 690 Ft
   Közepes fényt és öntözést igényel, kezdőbarát
   31 db raktáron, ⭐4,7 (176 értékelés) – ez a legnépszerűbb és legjobban értékelt darab

3. Nyúlfül kaktusz (Opuntia microdasys) – 1 990 Ft
   Direkt napfényt szeret, ritka öntözés, de haladóbb gondozást igényel
   35 db raktáron, ⭐4,3 (76 értékelés)
```

A háttérben az agent egy `runSql` tool-hívással a `category = 'kaktusz'` szűrésű SQL-t futtatta le a read-only kapcsolaton, majd ebből építette fel a fenti választ.
