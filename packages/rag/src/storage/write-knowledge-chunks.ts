import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import '../config/env.js';

// Raw `pg` against the read-write DATABASE_URL, not Prisma: the `embedding`
// column is `Unsupported("vector(1024)")` in packages/db/prisma/schema.prisma
// (Prisma has no native pgvector type), so the Prisma Client cannot read or
// write it at all — every access has to be raw SQL regardless. Keeping this
// on a plain `pg` Pool mirrors packages/core's readonly-db-client.ts (raw
// `pg` against DATABASE_URL_READONLY) — write-side and read-side of the
// same "two connections, two rights" pattern (architektura.md #2), Prisma
// staying the schema/migration owner only (packages/db).

let pool: Pool | undefined;

function getPool(): Pool {
  if (pool) {
    return pool;
  }
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set — copy .env.example to .env at the repo root.',
    );
  }
  pool = new Pool({ connectionString });
  return pool;
}

export interface KnowledgeChunkRecord {
  articleSlug: string;
  title: string;
  source: string;
  sectionPath: string | null;
  content: string;
  embedding: number[];
}

/**
 * Persists chunk records (with their already-computed embeddings) into
 * `knowledge_chunks`. `content_hash` is derived here (not stored on `Chunk`
 * itself — dontesek-hf3.md #9's Chunk shape stays chunking-only) so the
 * hash always reflects exactly what's in the DB.
 */
export async function writeKnowledgeChunks(
  records: KnowledgeChunkRecord[],
): Promise<void> {
  const client = getPool();
  for (const record of records) {
    const contentHash = createHash('sha256')
      .update(record.content)
      .digest('hex');
    const vectorLiteral = `[${record.embedding.join(',')}]`;

    await client.query(
      `INSERT INTO knowledge_chunks
         (article_slug, title, source, section_path, content, content_hash, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
      [
        record.articleSlug,
        record.title,
        record.source,
        record.sectionPath,
        record.content,
        contentHash,
        vectorLiteral,
      ],
    );
  }
}

/** Closes the pool. Tests use this to avoid leaving open DB handles. */
export async function closeWritePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
