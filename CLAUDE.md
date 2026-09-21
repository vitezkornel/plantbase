# CLAUDE.md

Ez a fájl útmutatást ad a Claude Code (claude.ai/code) számára az ebben a repóban végzett munkához.

## Fontos, kézzel felvett szabályok (ne töröld /init futtatásakor!)

- Valahányszor új MCP-szervert adunk hozzá a `.mcp.json`-hoz, mindig frissítsd vele a `.mcp.json.example` sablont is.
- Valahányszor a `docs/system-prompt.md` módosul, mindig frissítsd vele szinkronban a ténylegesen futásidejű `.ts` mirror-fájl (`packages/core/src/agents/ask-agent/ask-agent-prompt.ts`) tartalmát is, automatikusan, kérés nélkül.

## Projekt-áttekintés

A Plantbase egy CLI AI agent, amely a felhasználó természetes nyelvű kérdését SQL-re fordítja egy növény-katalógus (`products` tábla) felett, read-only lefuttatja, és magyarul válaszol — a felhasználónak nincs szüksége SQL-tudásra. A teljes funkcionális áttekintésért és a beüzemelési lépésekért lásd a `README.md`-t, az agent pontos system promptjáért pedig a `docs/system-prompt.md`-t.

## Parancsok

### Környezet felállítása (egyszeri lépés)

```bash
pnpm install
cp .env.example .env   # legalább az ANTHROPIC_API_KEY-t töltsd ki
docker compose up -d   # elindítja a Postgres-t (konténer: plantbase-postgres)

# Létrehozza a read-only plantbase_readonly Postgres role-t (idempotens):
docker exec -i plantbase-postgres psql -U plantbase -d plantbase \
  -v pw="$POSTGRES_READONLY_PASSWORD" -f /dev/stdin < packages/db/sql/create-readonly-role.sql

pnpm --filter db exec prisma migrate deploy
pnpm --filter db exec prisma db seed
```

### Build és futtatás

```bash
pnpm nx build cli                                    # lebuildeli az apps/cli/dist/main.js-t
node apps/cli/dist/main.js ask "<kérdés>"            # egyszeri lekérdezés
node apps/cli/dist/main.js ask                       # interaktív (readline; "exit"-tel lépsz ki)
node apps/cli/dist/main.js ask --show-prompt "<k>"   # a system promptot + a teljes üzenet-tömböt is kiírja
```

### Teszt / lint / típusellenőrzés

```bash
pnpm nx run-many -t test                                          # teljes tesztsuite, mindhárom projekt
pnpm nx test core                                                 # egy projekt (core | db | cli)
pnpm nx test core -- src/tools/list-categories/list-categories-tool.spec.ts  # egyetlen tesztfájl
pnpm nx run-many -t lint,typecheck                                 # az egész workspace-re
```

A `packages/core` `tools/run-sql` és `tools/list-categories` mappája, valamint a `packages/db` `readonly-role.spec.ts` fájlja **élő** integrációs teszteket is tartalmaz a `DATABASE_URL_READONLY` ellen — ezek sikeréhez a compose Postgres konténernek futnia kell, migrálva és seedelve (nincsenek mockolva).

## Architektúra

Nx monorepo (pnpm workspace-ek), 3, egymástól függetlenül buildelhető/tesztelhető projekt: `core`, `db`, `cli`.

- **`packages/core`** — az agent.
  - `agents/agent-loop.ts` — vékony wrapper a Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) `generateText`/`stopWhen: stepCountIs(MAX_ITERATIONS)` (6) multi-step tool-use loopja körül: a `tools` egy név szerint kulcsolt rekord (ez maga a dispatch-tábla — nincs külön központi registry). A wrapper két, az SDK által csendben kezelt esetet emel vissza dobott hibává, hogy a korábbi, kézzel írt loop viselkedését megőrizze: a max-iterációs limit csendes levágását, és azt, ha a modell egy nem regisztrált tool nevet kér (`NoSuchToolError`) — mindent mást (egy tool `{ok:false, error}` kimenetét, vagy akár egy `execute`-on belüli el nem kapott dobást is) az SDK már magától kecsesen, a modellnek visszaadható tool-resultté alakít.
  - `agents/ask-agent/ask-agent.ts` — `askAgent(question)`, a termék felé mutató belépési pont. Bekötti a system promptot és a regisztrált toolokat (`runSqlTool`, `listCategoriesTool`) a loopba, a `logging/jsonl-logger.ts`-en keresztül JSONL interakció-logot ír, és nyers adatot ad vissza (válasz, teljes üzenet-tömb, system prompt, token-használat) — framework/I/O-független, így bármelyik hívó (ma az `apps/cli`) egyszerűen csak kiírja az eredményt.
  - `agents/ask-agent/ask-agent-prompt.ts` — a `docs/system-prompt.md` XML-tartalmának szó szerinti mirror-ja. A kettő szinkronban tartása kézi konvenció (lásd a fenti házirend-szabályt), nem tesztelt automatikusan.
  - `tools/tool-outcome.ts` — a megosztott `ToolOutcome` forma, amit minden tool `execute`-ja visszaad. Minden tool a Vercel AI SDK `tool()` helperével épül fel (Zod `inputSchema` be, a modell felé menő JSON Schema-t az SDK vezeti le belőle automatikusan — nincs többé kézzel duplikált nyers JSON Schema), és egy új tool regisztrálása csak egysoros bővítés az `ask-agent.ts` `tools` rekordjában, ahelyett hogy egy karbantartandó központi dispatch-táblát kellene vezetni.
  - `tools/readonly-db-client.ts` — az egyetlen, megosztott `pg` `Pool` a `DATABASE_URL_READONLY` ellen, amit minden read-only DB-hozzáférést igénylő tool újrahasznál (jelenleg a `run-sql` és a `list-categories`).
  - `tools/run-sql/` — a `runSql` tool: a modell saját maga generálta SQL, amit a `sql-guard.ts` valid (egy kulcsszó-alapú guard, ami csak egyetlen SELECT/WITH statementet enged — elutasítja a stacked statementeket és az adatmódosító CTE-bypasseket), mielőtt egyáltalán eljutna a DB-hez.
  - `tools/list-categories/` — a `listCategories` tool: egyetlen fix `SELECT DISTINCT category FROM products` lekérdezés, nincs modell-generálta SQL, így guard-ra sincs szükség.
  - Minden tool saját könyvtára tartalmazza mindazt, ami rá jellemző (séma, guard ha van, teszt); ami több toolnak is kell, az egy szinttel feljebb lakik, ahelyett hogy toolonként duplikálódna.
- **`packages/db`** — a **read-write** `DATABASE_URL` kapcsolat gazdája: Prisma séma, migrációk és seed (`prisma.config.ts` — a Prisma 7 config-alapú seed-hookja, nem egy `package.json`-beli `"prisma"` kulcs; a futtatáshoz cwd = `packages/db` szükséges, pl. `pnpm --filter db exec prisma ...` formában). Az `sql/create-readonly-role.sql` hozza létre a külön, read-only Postgres role-t, amivel a `packages/core` közvetlenül kapcsolódik.
- **`apps/cli`** — csak egy commander-alapú I/O-felszín (`ask` parancs, egyszeri vagy interaktív); nincs benne üzleti logika azon túl, hogy az stdin/argv-t bekötti az `askAgent`-be, és kiírja a nyers eredményét.

**Két DB-kapcsolat, két jog** a fő biztonsági alapelv: a `DATABASE_URL` (read-write, Prisma, csak a `packages/db` használja) vs. a `DATABASE_URL_READONLY` (csak SELECT-et engedő Postgres role, nyers `pg` kliens, csak a `packages/core` toolja használja — soha nem Prismán keresztül). Az agentnek nincs olyan kódútja, ami írni tudna az adatbázisba — ezt két, egymástól független rétegen kényszerítjük ki: az alkalmazás-szintű SQL guard (`sql-guard.ts`) és a Postgres role saját jogosultságai.
