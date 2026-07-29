-- packages/db/sql/create-readonly-role.sql
--
-- Creates the `plantbase_readonly` Postgres role used later by the agent's
-- `runSql` tool (architektura.md #2, #6). This role connects directly via
-- the `pg` driver — it is NEVER used through Prisma. Grants are intentionally
-- minimal: CONNECT on the database, USAGE on the `public` schema, and SELECT
-- on `products` only. No INSERT/UPDATE/DELETE, no DDL, no other tables.
--
-- Run against the running compose Postgres, e.g.:
--   docker exec -i plantbase-postgres psql -U plantbase -d plantbase \
--     -v pw="$POSTGRES_READONLY_PASSWORD" -f /dev/stdin < packages/db/sql/create-readonly-role.sql
--
-- Requires the `pw` psql variable to be set to the desired role password
-- (see POSTGRES_READONLY_PASSWORD in .env). The password is never hardcoded
-- here — see docs/konvenciok.md "Biztonság": secrets live in .env, never
-- in the repo.
--
-- Idempotent: safe to re-run (role creation and grants are guarded/repeatable).
--
-- NOTE: role creation intentionally avoids a `DO $$ ... $$` block. psql does
-- NOT perform `:'pw'` variable substitution inside dollar-quoted strings
-- (it treats the body as opaque, same as a single-quoted literal), so the
-- password could never reach a `CREATE ROLE ... PASSWORD :'pw'` written
-- inside `DO $$ ... $$`. Using \gexec with a plain (non-dollar-quoted)
-- SELECT keeps the substitution working while staying idempotent: the
-- SELECT only produces a row (and thus only \gexec executes anything) when
-- the role does not already exist.
SELECT format('CREATE ROLE plantbase_readonly WITH LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plantbase_readonly')
\gexec

GRANT CONNECT ON DATABASE plantbase TO plantbase_readonly;
GRANT USAGE ON SCHEMA public TO plantbase_readonly;
GRANT SELECT ON products TO plantbase_readonly;
-- knowledge_chunks (docs/rag-proposal.md #2): the search-knowledge tool
-- (packages/core, R5) reads this via the same read-only connection.
GRANT SELECT ON knowledge_chunks TO plantbase_readonly;

-- Defense-in-depth: also default future tables in `public` to read-only for
-- this role, so a later `prisma migrate dev` adding tables doesn't silently
-- grant write access. Only applies to objects created by the role that runs
-- this script (the migration/owner role), which matches our single-owner
-- (`plantbase`) setup.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO plantbase_readonly;
