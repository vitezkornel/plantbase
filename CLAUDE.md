# CLAUDE.md

Ez a fájl útmutatást ad a Claude Code (claude.ai/code) számára az ebben a repóban végzett munkához.

## Fontos, kézzel felvett szabályok (ne töröld /init futtatásakor!)

- Valahányszor új MCP-szervert adunk hozzá a `.mcp.json`-hoz, mindig frissítsd vele a `.mcp.json.example` sablont is.
- Valahányszor a `docs/system-prompt.md` módosul, mindig frissítsd vele szinkronban a ténylegesen futásidejű `.ts` mirror-fájl (`packages/core/src/agents/ask-agent/ask-agent-prompt.ts`) tartalmát is, automatikusan, kérés nélkül.

## Project overview

Plantbase is a CLI AI agent that translates a natural-language question into SQL over a plant-catalog `products` table, runs it read-only, and answers in Hungarian — no SQL knowledge required from the user. See `README.md` for the full functional overview and setup walkthrough, and `docs/system-prompt.md` for the agent's exact system prompt.

## Commands

### Environment setup (one-time)

```bash
pnpm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY at minimum
docker compose up -d   # starts Postgres (container: plantbase-postgres)

# Create the read-only plantbase_readonly Postgres role (idempotent):
docker exec -i plantbase-postgres psql -U plantbase -d plantbase \
  -v pw="$POSTGRES_READONLY_PASSWORD" -f /dev/stdin < packages/db/sql/create-readonly-role.sql

pnpm --filter db exec prisma migrate deploy
pnpm --filter db exec prisma db seed
```

### Build & run

```bash
pnpm nx build cli                                    # builds apps/cli/dist/main.js
node apps/cli/dist/main.js ask "<question>"          # one-shot
node apps/cli/dist/main.js ask                       # interactive (readline; "exit" to quit)
node apps/cli/dist/main.js ask --show-prompt "<q>"   # also prints system prompt + full message array
```

### Test / lint / typecheck

```bash
pnpm nx run-many -t test                                          # full suite, all 3 projects
pnpm nx test core                                                 # one project (core | db | cli)
pnpm nx test core -- src/tools/list-categories/list-categories-tool.spec.ts  # single test file
pnpm nx run-many -t lint,typecheck                                 # workspace-wide
```

`tools/run-sql` and `tools/list-categories` in `packages/core`, and `readonly-role.spec.ts` in `packages/db`, include **live** integration tests against `DATABASE_URL_READONLY` — the compose Postgres container must be up, migrated, and seeded for these to pass (they are not mocked).

## Architecture

Nx monorepo (pnpm workspaces), 3 independently buildable/testable projects: `core`, `db`, `cli`.

- **`packages/core`** — the agent.
  - `agents/agent-loop.ts` — hand-written (no agent framework) Anthropic tool-use loop: calls the model, dispatches any `tool_use` blocks to the matching entry in the `tools` array by name (the array passed in *is* the dispatch table — no separate central registry), appends `tool_result`s, repeats up to `MAX_ITERATIONS` (6).
  - `agents/ask-agent/ask-agent.ts` — `askAgent(question)`, the product-facing entry point. Wires the system prompt and registered tools (`runSqlTool`, `listCategoriesTool`) into the loop, writes a JSONL interaction log via `logging/jsonl-logger.ts`, and returns plain data (answer, full message array, system prompt, usage) — framework/I/O-agnostic, so any caller (today `apps/cli`) just prints the result.
  - `agents/ask-agent/ask-agent-prompt.ts` — a byte-for-byte mirror of `docs/system-prompt.md`'s XML content. Keeping these in sync is a manual convention (see the house rule above), not enforced by a test.
  - `tools/tool-outcome.ts` — the shared `AgentTool` / `ToolOutcome` shape every tool implements; this is what makes registering a new tool a one-line addition to the `tools` array in `ask-agent.ts` instead of a central dispatch table to maintain.
  - `tools/readonly-db-client.ts` — the one shared `pg` `Pool` against `DATABASE_URL_READONLY`, reused by every tool that needs read-only DB access (currently `run-sql` and `list-categories`).
  - `tools/run-sql/` — the `runSql` tool: the model's own SQL, validated by `sql-guard.ts` (a keyword-scan guard that only allows a single SELECT/WITH statement — rejects stacked statements and data-modifying CTE bypasses) before it ever reaches the DB.
  - `tools/list-categories/` — the `listCategories` tool: one fixed `SELECT DISTINCT category FROM products` query, no model-generated SQL, so no guard is needed.
  - Each tool's own directory holds everything specific to it (schema, guard if any, spec); anything shared by more than one tool lives one directory up instead of being duplicated per tool.
- **`packages/db`** — owns the **read-write** `DATABASE_URL` connection: Prisma schema, migrations, and seed (`prisma.config.ts` — Prisma 7's config-based seed hook, not a `package.json` `"prisma"` key; must be run with cwd = `packages/db`, e.g. via `pnpm --filter db exec prisma ...`). `sql/create-readonly-role.sql` provisions the separate read-only Postgres role that `packages/core` connects with directly.
- **`apps/cli`** — commander-based I/O surface only (`ask` command, one-shot or interactive); no business logic beyond wiring stdin/argv to `askAgent` and printing its plain-data result.

**Two DB connections, two rights** is the core security invariant: `DATABASE_URL` (read-write, Prisma, used only by `packages/db`) vs. `DATABASE_URL_READONLY` (SELECT-only Postgres role, raw `pg` client, used only by `packages/core`'s tools — never through Prisma). The agent has no code path capable of writing to the database, enforced independently at two layers: the application-level SQL guard (`sql-guard.ts`) and the Postgres role's own grants.
