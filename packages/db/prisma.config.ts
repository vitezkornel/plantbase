import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Root .env (task A3) lives two levels up from this package, not next to
// schema.prisma — Prisma 7 no longer auto-loads .env files, so load it
// explicitly. Commands must be run with cwd = packages/db (e.g. via
// `pnpm --filter db exec prisma ...`) for this relative path to resolve.
loadEnv({ path: resolve(process.cwd(), '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Prisma 7: the `db seed` hook is configured here (migrations.seed),
    // not via a `"prisma": { "seed": ... }` entry in package.json.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
