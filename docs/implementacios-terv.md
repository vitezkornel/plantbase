# Plantbase — implementációs terv

## Context

A `docs/` mappa hat dokumentuma (brs-plantbase.md, architektura.md, stack.md, konvenciok.md, dev-workflow.md, system-prompt.md) a teljes build brief a `plantbase` CLI agenthez: egy read-only NL→SQL asszisztens a `products` növény-katalógus felett. Ez a dokumentum ezekből egy végrehajtható, fázisolt implementációs terv, lépésről lépésre követhető és tesztelhető.

A repo jelenleg üres (nincs `.git`, nincs kód, csak a 6 doc + `.env` + `.mcp.json`). Tisztázott előfeltételek: Windows gépen dolgozunk, ezért **Docker Desktop** fut OrbStack helyett (a compose fájl ettől nem változik); Node (v24.18.0), pnpm (11.12.0), Docker (29.6.1), gh CLI mind telepítve vannak.

A terv két részből áll: **A) a környezet felállítása** (mérföldkő: fut és tesztelhető a repo), majd **B) 3 réteges implementációs fázis** (echo → LLM DB nélkül → LLM + SQL). Minden lépés kicsi, önállóan tesztelhető increment, végén egy fókuszált commit (Conventional Commits, feature branch — `dev-workflow.md`).

## Globális szabályok (minden lépésre érvényesek)

- **Context7 kódolás előtt.** Minden lépés elején, ahol új/ritkán használt library API-t vezetünk be (Nx, Prisma, Anthropic TS SDK, commander), ELŐBB Context7-tel beolvassuk az aktuális doksit, csak utána kódolunk (`architektura.md` #7). Megjegyzés: a `context7` MCP szerver most lett felvéve user-scope-ban; ha a jelen munkamenetben még nem érhető el a tool, előbb újra kell indítani/jóváhagyni a Claude Code-ot, mielőtt az A1/A4/B2/B3 lépések kódolása elkezdődik.
- **Fájlkonvenciók** (`konvenciok.md`) mindvégig: kebab-case fájlnév, típus-utótag (`*-agent.ts`, `*-tool.ts`, `*-prompt.ts`, `*-schema.ts`, `*.spec.ts`), egy fogalom = egy könyvtár a teljes felszereléssel (agent/tool mappa: séma, guard, kliens, teszt egy helyen), közös kód eggyel kintebb (`agents/agent-loop.ts`, `tools/tool-outcome.ts`), teszt a kód mellett, nincs `console.log` → strukturált logger, Zod a rendszerhatárokon, a termék-promptok XML-szerű tagekkel.
- **Git**: `main` mindig zöld, direkt commit tilos rá; minden lépés `feat/<...>` (vagy `chore/`, `fix/`) branchen, majd fókuszált commit. Nincs GitHub remote push, amíg nem kéred külön.
- **Két DB-kapcsolat**: `DATABASE_URL` (read-write, Prisma migrate/seed), `DATABASE_URL_READONLY` (csak SELECT, ezt használja a `runSql` tool — NEM Prismán keresztül).

---

## A) RÉSZ — Környezet létrehozása

**A0 — Repo init**
`git init`, `.gitignore` (node_modules, dist, .env, logs/), rövid README.
*Teszt:* `git status` tiszta, `git log` mutatja a kezdő commitot.
*Commit:* `chore: init git repository`

**A1 — Nx monorepo workspace**
Context7: Nx docs (integrated monorepo, TS setup). `pnpm`-alapú Nx workspace, TypeScript strict tsconfig, ESLint+Prettier, Vitest test-runner bekötve. `packages/`, `apps/` mappák.
*Teszt:* `pnpm install` és `pnpm nx graph`/`pnpm nx report` hibátlanul lefut.
*Commit:* `chore: bootstrap nx monorepo (pnpm, ts strict, eslint/prettier, vitest)`

**A2 — apps/cli váz**
Context7: commander docs. Nx node-app `cli`, commander-rel bekötve, még parancs-logika nélkül (csak `--help`/`--version`).
*Teszt:* `pnpm nx build cli` lefut, a build kimenet `--help`-re használati leírást ír ki.
*Commit:* `feat: scaffold empty cli app`

**A3 — docker-compose Postgres**
Root `docker-compose.yml`: postgres szolgáltatás (pinnelt stabil verzió, pl. `postgres:16`), named volume, env (user/pass/db), exponált port.
*Teszt:* `docker compose up -d`, `docker compose ps` healthy, kapcsolódás sikeres (`psql` vagy `docker exec`).
*Commit:* `chore: add docker-compose postgres`

**A4 — packages/db: Prisma séma + migráció + read-only role**
Context7: Prisma docs (schema, `migrate dev`, `db seed` hook) — ritkán használt API, doksi előbb. Nx lib `packages/db`, `prisma/schema.prisma` a `products` modellel (`stack.md` szerinti összes mező/típus). `.env`-ben kitöltjük a `DATABASE_URL`-t (a most felhúzott compose Postgres felé), lefuttatjuk `prisma migrate dev --name init_products`-t. Külön SQL-szkript hoz létre egy read-only Postgres role-t (`plantbase_readonly`): `CONNECT` + `USAGE` a sémán + `SELECT` a `products`-on, semmi más. `.env`-ben kitöltjük a `DATABASE_URL_READONLY`-t erre a role-ra.
*Teszt:* migráció után létezik a `products` tábla; a readonly kapcsolattal `SELECT` megy, egy próba `INSERT` permission denied-del elbukik.
*Commit:* `feat(db): add products schema, migration, and read-only role`

**A5 — Szintetikus seed (~30 növény)**
`packages/db/prisma/seed.ts`: kb. 30 sor, valós latin fajnevekkel, reális ár/készlet/fény/öntözés/méret értékekkel, a `stack.md` értékkészletei szerint (category, location, light, watering, difficulty enumok betartva).
*Teszt:* `prisma db seed` után `SELECT count(*) FROM products` = 30, néhány sor kézzel átnézve értelmes.
*Commit:* `feat(db): add ~30-plant synthetic seed data`

**Mérföldkő:** a környezet kész — fut az Nx workspace, a DB-ben van séma+migráció+seed, a CLI elindul (üresen). Itt megállunk, és jelezni kell, ha mehet tovább a B) részre.

---

## B) RÉSZ — 3 fázis (rétegenként látható működés)

**Fázis 1 — CLI echo (LLM és DB nélkül)**
`apps/cli`: `ask "<kérdés>"` egyszeri parancs + interaktív readline mód (`exit`-ig) — FR1. Egyelőre csak visszaírja, amit kaptunk (pl. `Echo: <input>`).
*Teszt:* `plantbase ask "szia"` visszaechózza; interaktív módban több sor begépelve mindegyik visszajön, `exit` kilép.
*Commit:* `feat(cli): add ask command and interactive echo mode`

**Fázis 2 — LLM, adatbázis nélkül**
Context7: Anthropic TypeScript SDK docs (hivatalos kliens, messages API, tool-use alapok) — mielőtt az `askAgent`-et megírjuk. `packages/core`: `agents/ask-agent/ask-agent.ts` + `agents/agent-loop.ts` (közös loop-mag, egy szinttel kintebb a konvenció szerint), egyelőre tool nélkül. Ideiglenes system prompt (nem a végleges `system-prompt.md`), ami világosan közli a modellel, hogy még nincs adatbázis-hozzáférése. A CLI `ask` parancsa mostantól az agentet hívja, nem echóz. Naplózás (FR4, részleges): `logs/<timestamp>.jsonl` — system prompt, üzenetek, válasz, token-használat. `--show-prompt` (FR5): kiírja a teljes üzenet-tömböt.
*Teszt:* általános kérdésre értelmes LLM-válasz jön; katalógus-kérdésre ("mennyibe kerül egy pozsgás?") az agent őszintén jelzi, hogy nincs adatbázis-hozzáférése, nem talál ki adatot.
*Commit:* `feat(core): wire cli to anthropic sdk agent without db access`

**Fázis 3 — SQL-es interakció (runSql tool)**
Context7: Prisma / `pg` driver docs a paraméterezett, read-only lekérdezés-futtatáshoz (a `runSql` NEM Prismán megy, hanem közvetlen `pg` kliensen a `DATABASE_URL_READONLY` felé — `architektura.md` #2). Új könyvtár: `tools/run-sql/` — a tool definíciója, Zod input-séma, SELECT-only guard (elutasítja az INSERT/UPDATE/DELETE/DDL-t és a többszörös statementeket), a readonly `pg` kliens, és a teszt egy helyen. A `schema-context` mostantól a végleges `system-prompt.md` XML-tartalmát adja (role/task/schema/rules/behavior/tools). A tool bekötése az agent toolsetjébe egy soros bejegyzés. Az agent-loop multistep: SQL-t generál → `runSql`-lel lefuttatja → az eredményből természetes nyelvű választ ad (FR2, FR3). Naplózás kiegészül a generált SQL-lel és az eredménnyel.
*Teszt:* valós katalógus-kérdésekre (büdzsé, fényigény, háziállat-barát stb.) helyes SQL generálódik, lefut, érthető magyar válasz jön; egy manipulációra rábeszélő kérdésnél a guard (és a DB-role is) blokkol.
*Commit:* `feat(core): add runSql tool and wire full agent for nl-to-sql answers`

---

## Verifikáció (végponttól végpontig)

- Demo-kritérium (`brs-plantbase.md` 5. pont): élő kérdés → helyes SQL → helyes válasz.
- `--show-prompt` kimenet ellenőrzése.
- `logs/*.jsonl` bejegyzések átnézése (system prompt, SQL, eredmény, token-használat jelen van).
- Egy próbált mutáló kérdés (pl. "töröld ki a...") blokkolva van guard + DB-role szinten is (defense in depth).
- `pnpm nx run-many -t test` zöld minden lépés után.

## Hatókörön kívül (ebben a tervben nem szerepel)

- `docs/ddd/*`, `docs/tech/*` — ezeket a `ddd-audit` skill tölti fel, külön, `dev-workflow.md` szerint.
- `apps/api`, `apps/web` — későbbi órák anyaga.
- GitHub remote push — csak külön kérésre.
