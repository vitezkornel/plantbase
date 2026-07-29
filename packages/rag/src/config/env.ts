import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { REPO_ROOT } from './repo-root.js';

// Side-effecting module: importing it loads the root `.env` into
// `process.env`, mirroring packages/core/src/config/env.ts (see that file
// for why REPO_ROOT-based resolution is used instead of import.meta.url).
const rootEnvPath = resolve(REPO_ROOT, '.env');
loadEnv({ path: rootEnvPath });
