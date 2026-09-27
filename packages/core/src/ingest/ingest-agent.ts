// packages/core/src/ingest/ingest-agent.ts
//
// The feed-ingest agent (`ingestProduct`): a separate L2 agent next to the
// read-only ask-agent, on the same shared loop (agents/agent-loop.ts). It is
// the ONLY agent whose toolset can write to the database — via
// `upsertProducts` → packages/db (read-write Prisma, DATABASE_URL). The
// ask-agent never registers these tools, so its read-only guarantee
// (DATABASE_URL_READONLY + sql-guard) is unchanged.

import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel, ModelMessage } from 'ai';
import { z } from 'zod';
import '../config/env.js';
import { runAgentLoop, type ToolCallRecord } from '../agents/agent-loop.js';
import {
  writeInteractionLog,
  type AgentUsage,
} from '../logging/jsonl-logger.js';
import { INGEST_AGENT_SYSTEM_PROMPT } from './ingest-agent-prompt.js';
import {
  SCRAPE_PRODUCTS_TOOL_NAME,
  scrapeProductsTool,
} from './scrape-products/scrape-products-tool.js';
import {
  UPSERT_PRODUCTS_TOOL_NAME,
  upsertProductsTool,
} from './upsert-products/upsert-products-tool.js';

/** Closes the read-write DB connection opened by `upsertProducts` (CLI shutdown). */
export { disconnectProductWriter as closeIngestConnections } from 'db';

const MODEL_ID = 'claude-sonnet-5';
// Room for up to ~60 Hungarian descriptions in one upsertProducts call.
const MAX_TOKENS = 16000;
const MAX_ITERATIONS = 8;

const IngestInputSchema = z.object({
  request: z.string().min(1, 'request must not be empty'),
});

export interface IngestProductDeps {
  /** Injectable for tests; defaults to the real Anthropic provider. */
  model?: LanguageModel;
  /** Injectable for tests; defaults to the real scrape/upsert tools. */
  tools?: Parameters<typeof runAgentLoop>[0]['tools'];
}

export interface IngestProductResult {
  answer: string;
  messages: ModelMessage[];
  system: string;
  usage: AgentUsage;
  /** Names of the tools called, in order (e.g. scrapeProducts, upsertProducts). */
  toolCalls: string[];
  logPath: string;
}

/**
 * Runs the ingest agent for one natural-language request, e.g.
 * "frissítsd a fikuszokat a tropicalhome-ról". Framework-agnostic: plain
 * data in and out; the caller (apps/cli `ingest`) does the I/O.
 */
export async function ingestProduct(
  request: string,
  deps: IngestProductDeps = {},
): Promise<IngestProductResult> {
  const { request: validRequest } = IngestInputSchema.parse({ request });

  const messages: ModelMessage[] = [{ role: 'user', content: validRequest }];
  const result = await runAgentLoop({
    model: deps.model ?? anthropic(MODEL_ID),
    maxTokens: MAX_TOKENS,
    maxIterations: MAX_ITERATIONS,
    system: INGEST_AGENT_SYSTEM_PROMPT,
    messages,
    tools: deps.tools ?? {
      // one-line-per-tool registration (konvenciok.md)
      [SCRAPE_PRODUCTS_TOOL_NAME]: scrapeProductsTool,
      [UPSERT_PRODUCTS_TOOL_NAME]: upsertProductsTool,
    },
  });

  const logPath = await writeInteractionLog({
    system: INGEST_AGENT_SYSTEM_PROMPT,
    messages: result.messages,
    response: result.finalText,
    usage: result.usage,
    sqlCalls: [],
    escalated: false,
  });

  return {
    answer: result.finalText,
    messages: result.messages,
    system: INGEST_AGENT_SYSTEM_PROMPT,
    usage: result.usage,
    toolCalls: result.toolCalls.map((call: ToolCallRecord) => call.name),
    logPath,
  };
}
