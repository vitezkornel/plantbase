import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { REPO_ROOT } from './repo-root.js';

// `packages/core` is a library, not a CLI entry point — unlike
// `packages/db/prisma.config.ts` (which can assume `cwd === packages/db`
// because Prisma commands are always invoked via `pnpm --filter db exec
// prisma ...`), this module is `import`ed from `apps/cli` and must not
// depend on the caller's current working directory being any particular
// package directory. `REPO_ROOT` (see ./repo-root.ts) finds the monorepo
// root regardless of where the CLI was invoked from or how this file was
// compiled (see repo-root.ts for why we don't use import.meta.url here).
const rootEnvPath = resolve(REPO_ROOT, '.env');

// Side-effecting module: importing it loads the root `.env` into
// `process.env` (if not already loaded) so `new Anthropic()` can pick up
// `ANTHROPIC_API_KEY` without every caller having to know where `.env`
// lives. Safe to import multiple times — `dotenv` does not override
// variables that are already set in `process.env`.
loadEnv({ path: rootEnvPath });
