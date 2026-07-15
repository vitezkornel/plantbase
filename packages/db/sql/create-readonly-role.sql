-- packages/db/sql/create-readonly-role.sql
--
-- Creates the `plantbase_readonly` Postgres role used later by the agent's
-- `runSql` tool (architektura.md #2, #6). This role connects directly via
-- the `pg` driver — it is NEVER used through Prisma. Grants are intentionally
-- minimal: CONNECT on the database, USAGE on the `public` schema, and SELECT
-- on `products` only. No INSERT/UPDATE/DELETE, no DDL, no other tables.
--
-- Run against the running compose Postgres, e.g.:
--   docker exec -i plantbase-postgres psql -U plantbase -d plantbase < packages/db/sql/create-readonly-role.sql
--
-- Idempotent: safe to re-run (role creation and grants are guarded/repeatable).
DO
$$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'plantbase_readonly') THEN
    CREATE ROLE plantbase_readonly WITH LOGIN PASSWORD 'plantbase_readonly';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE plantbase TO plantbase_readonly;
GRANT USAGE ON SCHEMA public TO plantbase_readonly;
GRANT SELECT ON products TO plantbase_readonly;

-- Defense-in-depth: also default future tables in `public` to read-only for
-- this role, so a later `prisma migrate dev` adding tables doesn't silently
-- grant write access. Only applies to objects created by the role that runs
-- this script (the migration/owner role), which matches our single-owner
-- (`plantbase`) setup.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO plantbase_readonly;
