import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Shared by config/env.ts and logging/jsonl-logger.ts.
//
// Deliberately NOT using `import.meta.url`/`__dirname` here: `packages/core`
// is a TS-source-only workspace lib, resolved straight from `src/**` (see
// package.json `exports`) — in dev that runs as native ESM (Node's TS type
// stripping), but `apps/cli`'s esbuild build target (`format: cjs`,
// `bundle: false`) transpiles workspace-internal `.ts` files (unlike real
// npm deps, which stay external requires) into CJS output. esbuild cannot
// translate `import.meta.url` into anything meaningful under `cjs` output
// ("import.meta is not available with the cjs output format and will be
// empty") — confirmed by actually building `cli` and seeing the warning,
// not assumed — so any path derived from it would silently resolve to the
// wrong (or an undefined) location once the CLI is built. `__dirname`
// has the mirror-image problem: it doesn't exist under native ESM.
//
// Walking up from `process.cwd()` to find the repo root (marked by
// `pnpm-workspace.yaml`) avoids both: it only uses `fs`/`path`, which behave
// identically under ESM and CJS.
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not locate the plantbase repo root (no pnpm-workspace.yaml found walking up from ${startDir}). ` +
          'Run the CLI from inside the plantbase repo.',
      );
    }
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot(process.cwd());
