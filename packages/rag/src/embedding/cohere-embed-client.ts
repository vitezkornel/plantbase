import { CohereClient } from 'cohere-ai';
import { z } from 'zod';
import '../config/env.js';

// docs/rag-proposal.md #4: Cohere is the retrieval-math provider (embed +
// rerank), Anthropic stays the generation provider (HyDE + final answer).
//
// NOTE: the installed cohere-ai SDK's EmbedRequest type has no dimension
// override field (checked directly in node_modules — no `outputDimension`
// or similar), so the output dimension is whatever embed-v4.0's server-side
// default is (assumed 1536, matching Cohere's published default for this
// model — NOT yet confirmed against a real API response, since no
// COHERE_API_KEY was available while writing this). The pgvector column
// (packages/db/prisma/schema.prisma KnowledgeChunk.embedding) is sized to
// match this assumption; verify actual vector length against a real
// embedTexts() call before the R4 full ingest run, and adjust the column
// (new migration) if it doesn't match.
const EMBED_MODEL = 'embed-v4.0';

export type EmbedInputType = 'search_document' | 'search_query';

const EmbedTextsInputSchema = z
  .array(z.string().min(1))
  .min(1, 'texts must contain at least one non-empty string');

export interface EmbedTextsDeps {
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
 * Embeds `texts` with Cohere's embed-v4.0 model. `inputType` must match how
 * the text is used (`search_document` for ingest-time chunks,
 * `search_query` for a HyDE passage at retrieval time) — Cohere embeds
 * queries and documents into slightly different sub-spaces of the same
 * model for better retrieval quality.
 */
export async function embedTexts(
  texts: string[],
  inputType: EmbedInputType,
  deps: EmbedTextsDeps = {},
): Promise<number[][]> {
  const validTexts = EmbedTextsInputSchema.parse(texts);
  const client = deps.client ?? getDefaultClient();

  const response = await client.embed({
    texts: validTexts,
    model: EMBED_MODEL,
    inputType,
    embeddingTypes: ['float'],
  });

  const floatEmbeddings = response.embeddings;
  if (
    !floatEmbeddings ||
    typeof floatEmbeddings !== 'object' ||
    !('float' in floatEmbeddings) ||
    !Array.isArray(floatEmbeddings.float)
  ) {
    throw new Error(
      'Cohere embed response did not include float embeddings.',
    );
  }

  return floatEmbeddings.float;
}
