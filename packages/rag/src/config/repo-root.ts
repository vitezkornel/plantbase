import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Duplicated from packages/core/src/config/repo-root.ts on purpose: rag and
// core are meant to stay decoupled (dontesek-hf3.md #8), so a package-local
// path utility is preferable to a cross-package import just for this. See
// the core copy for the full rationale on why this walks up from cwd
// instead of using import.meta.url/__dirname.
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
          'Run from inside the plantbase repo.',
      );
    }
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot(process.cwd());
