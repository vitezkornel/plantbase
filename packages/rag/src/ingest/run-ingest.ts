import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { stripBoilerplate } from '../cleaning/strip-boilerplate.js';
import { chunkArticle, type Chunk } from '../chunking/chunk-article.js';
import {
  embedTexts,
  type EmbedInputType,
} from '../embedding/cohere-embed-client.js';
import { parseArticle } from '../parsing/parse-article.js';
import {
  writeKnowledgeChunks,
  type KnowledgeChunkRecord,
} from '../storage/write-knowledge-chunks.js';

export interface IngestDeps {
  /** Injectable for tests; defaults to the real Cohere embed call. */
  embed?: (texts: string[], inputType: EmbedInputType) => Promise<number[][]>;
  /** Injectable for tests; defaults to the real DB write. */
  write?: (records: KnowledgeChunkRecord[]) => Promise<void>;
}

export interface IngestSummary {
  articlesProcessed: number;
  chunksWritten: number;
}

/**
 * The full ingest batch (R4, docs/rag-proposal.md): every `*.md` file in
 * `articlesDir` goes through parse -> clean -> chunk -> embed -> store.
 * Embedding is batched one Cohere call per article (its chunks' content),
 * not per-chunk or for the whole corpus at once — safely under the SDK's
 * per-call text limit (96) even for the largest observed article (27
 * chunks, the glossary article — see docs/dontesek-hf3.md).
 */
export async function runIngest(
  articlesDir: string,
  deps: IngestDeps = {},
): Promise<IngestSummary> {
  const embed = deps.embed ?? embedTexts;
  const write = deps.write ?? writeKnowledgeChunks;

  const entries = await readdir(articlesDir);
  const articleFiles = entries.filter((name) => name.endsWith('.md'));

  let chunksWritten = 0;

  for (const fileName of articleFiles) {
    const chunks = await readAndChunkArticle(articlesDir, fileName);
    if (chunks.length === 0) {
      continue;
    }

    const embeddings = await embed(
      chunks.map((c) => c.content),
      'search_document',
    );

    const articleSlug = basename(fileName, '.md');
    const records: KnowledgeChunkRecord[] = chunks.map((chunk, i) => ({
      articleSlug,
      title: chunk.title,
      source: chunk.source,
      sectionPath: chunk.sectionPath,
      content: chunk.content,
      embedding: embeddings[i] ?? [],
    }));

    await write(records);
    chunksWritten += records.length;
  }

  return {
    articlesProcessed: articleFiles.length,
    chunksWritten,
  };
}

async function readAndChunkArticle(
  articlesDir: string,
  fileName: string,
): Promise<Chunk[]> {
  const raw = await readFile(join(articlesDir, fileName), 'utf-8');
  const parsed = parseArticle(raw);
  const cleanedBody = stripBoilerplate(parsed.body);
  return chunkArticle({ ...parsed, body: cleanedBody });
}
