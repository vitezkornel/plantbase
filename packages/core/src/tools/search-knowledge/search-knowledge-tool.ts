// packages/core/src/tools/search-knowledge/search-knowledge-tool.ts
//
// The `searchKnowledge` tool: HyDE -> embed -> vector search -> rerank ->
// grounding (docs/rag-proposal.md #5). Everything this ONE tool needs
// (HyDE prompt/call, rerank client, this orchestrator) lives in this ONE
// directory (konvenciok.md "egy fogalom = egy könyvtár"); the read-only DB
// client is shared one level up (readonly-db-client.ts), and the embedding
// client is shared with packages/rag's ingest side (embedTexts) since
// query- and ingest-time embeddings must come from the same model/space.

import { embedTexts, type EmbedInputType } from 'rag';
import type { AgentTool, ToolOutcome } from '../tool-outcome.js';
import { runReadonlyQuery } from '../readonly-db-client.js';
import { rerankDocuments, type RerankedItem } from './cohere-rerank-client.js';
import { generateHydePassage } from './hyde-generate.js';
import { SearchKnowledgeInputSchema } from './search-knowledge-schema.js';

export const SEARCH_KNOWLEDGE_TOOL_NAME = 'searchKnowledge';

// rag-proposal.md #5: 20 candidates pre-rerank is generous for this corpus
// size (~1500 chunks) without slowing down/costing much on the rerank
// call; top-5 post-rerank is enough grounding context per answer.
const CANDIDATE_COUNT = 20;
const FINAL_RESULT_COUNT = 5;

interface CandidateRow {
  title: string;
  source: string;
  sectionPath: string | null;
  content: string;
}

export interface SearchResult {
  title: string;
  source: string;
  sectionPath: string | null;
  content: string;
  relevanceScore: number;
}

export interface SearchKnowledgeDeps {
  generateHyde?: (query: string) => Promise<string>;
  embed?: (texts: string[], inputType: EmbedInputType) => Promise<number[][]>;
  search?: (vectorLiteral: string, limit: number) => Promise<CandidateRow[]>;
  rerank?: (
    query: string,
    documents: string[],
    topN: number,
  ) => Promise<RerankedItem[]>;
}

async function searchByVector(
  vectorLiteral: string,
  limit: number,
): Promise<CandidateRow[]> {
  const result = await runReadonlyQuery(
    `SELECT title, source, section_path, content
     FROM knowledge_chunks
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [vectorLiteral, limit],
  );
  return result.rows.map((row) => ({
    title: String(row['title']),
    source: String(row['source']),
    sectionPath: row['section_path'] === null ? null : String(row['section_path']),
    content: String(row['content']),
  }));
}

/**
 * Executes one `searchKnowledge` tool call: HyDE-generates an English
 * hypothetical passage from the (Hungarian) query, embeds it, vector-searches
 * `knowledge_chunks` for the top `CANDIDATE_COUNT`, reranks against the
 * original query, and returns the top `FINAL_RESULT_COUNT` with grounding
 * fields (title/source). An empty candidate set is a normal, `ok: true`
 * outcome with an empty `results` array — the system prompt is what turns
 * that into an honest "nincs találat" answer, not this tool.
 */
export async function executeSearchKnowledge(
  rawInput: unknown,
  deps: SearchKnowledgeDeps = {},
): Promise<ToolOutcome> {
  const parsed = SearchKnowledgeInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Érvénytelen searchKnowledge input: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    };
  }

  const generateHyde = deps.generateHyde ?? generateHydePassage;
  const embed = deps.embed ?? embedTexts;
  const search = deps.search ?? searchByVector;
  const rerank = deps.rerank ?? rerankDocuments;

  try {
    const hydePassage = await generateHyde(parsed.data.query);
    const [queryEmbedding] = await embed([hydePassage], 'search_query');
    if (!queryEmbedding) {
      throw new Error('Nem sikerült embeddinget készíteni a HyDE-bekezdéshez.');
    }

    const vectorLiteral = `[${queryEmbedding.join(',')}]`;
    const candidates = await search(vectorLiteral, CANDIDATE_COUNT);

    if (candidates.length === 0) {
      return { ok: true, data: { results: [] as SearchResult[] } };
    }

    const reranked = await rerank(
      parsed.data.query,
      candidates.map((c) => c.content),
      Math.min(FINAL_RESULT_COUNT, candidates.length),
    );

    const results: SearchResult[] = reranked
      .map((item) => {
        const candidate = candidates[item.index];
        return candidate ? { ...candidate, relevanceScore: item.relevanceScore } : null;
      })
      .filter((r): r is SearchResult => r !== null);

    return { ok: true, data: { results } };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Hiba a tudásbázis-keresés közben: ${message}`,
    };
  }
}

export const searchKnowledgeTool: AgentTool = {
  definition: {
    name: SEARCH_KNOWLEDGE_TOOL_NAME,
    description:
      'A növénygondozási tudásbázisban (data/knowledge cikkek) keres HyDE + rerank ' +
      'pipeline-nal. Ezt hívd, ha a kérdés ápolási/gondozási tanácsot kér, nem a ' +
      'products katalógusra vonatkozik. A visszaadott találatok title/source mezőjét ' +
      'mindig idézd forrásként a válaszban; ha a results tömb üres, mondd ki, hogy ' +
      'nincs erről információd a tudásbázisban.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A növénygondozási kérdés, a felhasználó saját szavaival.',
        },
      },
      required: ['query'],
    },
  },
  execute: (rawInput) => executeSearchKnowledge(rawInput),
};
