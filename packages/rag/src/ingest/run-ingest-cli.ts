import { resolve } from 'node:path';
import { REPO_ROOT } from '../config/repo-root.js';
import { runIngest } from './run-ingest.js';

async function main(): Promise<void> {
  const articlesDir = resolve(REPO_ROOT, 'data/knowledge');
  const summary = await runIngest(articlesDir);
  console.log(
    `Ingested ${summary.articlesProcessed} articles, wrote ${summary.chunksWritten} chunks to knowledge_chunks.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
