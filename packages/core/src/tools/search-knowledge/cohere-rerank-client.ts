// packages/core/src/tools/search-knowledge/cohere-rerank-client.ts
//
// docs/rag-proposal.md #4-5: rerank is query-time only (no ingest-side use),
// so this lives in the tool's own directory, not shared with packages/rag
// (whose cohere-embed-client.ts IS shared, since ingest and query both
// embed with the same model/dimension).

import { CohereClient } from 'cohere-ai';
import { z } from 'zod';
import '../../config/env.js';

const RERANK_MODEL = 'rerank-v4.0-pro';

const RerankDocumentsInputSchema = z
  .array(z.string())
  .min(1, 'documents must contain at least one entry');

export interface RerankedItem {
  index: number;
  relevanceScore: number;
}

export interface RerankDeps {
  /** Injectable for tests; defaults to a real Cohere client. */
  client?: CohereClient;
}

let defaultClient: CohereClient | undefined;

function getDefaultClient(): CohereClient {
  if (defaultClient) {
    return defaultClient;
  }
  const token = process.env['COHERE_API_KEY'];
  if (!token) {
    throw new Error(
      'COHERE_API_KEY is not set — copy .env.example to .env at the repo root.',
    );
  }
  defaultClient = new CohereClient({ token });
  return defaultClient;
}

/**
 * Reranks `documents` against `query`, returning the top `topN` as
 * `{ index, relevanceScore }` pairs (`index` refers back into the original
 * `documents` array) — the original (Hungarian) query, not the HyDE
 * passage, since rerank-v4.0-pro scores cross-lingually.
 */
export async function rerankDocuments(
  query: string,
  documents: string[],
  topN: number,
  deps: RerankDeps = {},
): Promise<RerankedItem[]> {
  const validDocuments = RerankDocumentsInputSchema.parse(documents);
  const client = deps.client ?? getDefaultClient();

  const response = await client.rerank({
    model: RERANK_MODEL,
    query,
    documents: validDocuments,
    topN,
  });

  return response.results.map((result) => ({
    index: result.index,
    relevanceScore: result.relevanceScore,
  }));
}
