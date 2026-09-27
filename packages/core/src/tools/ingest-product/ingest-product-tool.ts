// packages/core/src/tools/ingest-product/ingest-product-tool.ts
//
// The `ingestProduct` tool: wraps the whole feed-ingest agent
// (ingest/ingest-agent.ts, `ingestProduct`) as ONE tool, so a calling
// agent can delegate "tölts be …" requests to it. The inner agent runs its
// own loop (own model call, own scrapeProducts/upsertProducts tools, own
// JSONL log) and this tool only returns its summary.
//
// WRITE-CAPABLE: only the admin agent (agents/admin-agent) registers it.
// The ask-agent (CLI `ask`, customer-chat) must never register it — see
// CLAUDE.md "Két DB-kapcsolat, két jog".

import { tool } from 'ai';
import { ingestProduct as defaultIngestProduct } from '../../ingest/ingest-agent.js';
import type { ToolOutcome } from '../tool-outcome.js';
import { IngestProductToolInputSchema } from './ingest-product-schema.js';

export const INGEST_PRODUCT_TOOL_NAME = 'ingestProduct';

export interface IngestProductToolDeps {
  /** Injectable for tests; defaults to the real ingest agent. */
  ingestProduct?: (request: string) => Promise<{
    answer: string;
    toolCalls: string[];
    logPath: string;
  }>;
}

/**
 * Executes one `ingestProduct` call: validates the request, runs the inner
 * ingest agent to completion, and returns its answer. Never throws — a
 * failure of the inner agent comes back as `{ ok: false, error }`.
 */
export async function executeIngestProduct(
  rawInput: unknown,
  deps: IngestProductToolDeps = {},
): Promise<ToolOutcome> {
  const parsed = IngestProductToolInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Érvénytelen ingestProduct input: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    };
  }

  try {
    const result = await (deps.ingestProduct ?? defaultIngestProduct)(
      parsed.data.request,
    );
    return {
      ok: true,
      data: {
        answer: result.answer,
        toolCalls: result.toolCalls,
        logPath: result.logPath,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `Hiba a feltöltő agent futása közben: ${message}`,
    };
  }
}

/** Builds the tool; `deps` lets tests plug in an inner agent with a mock model. */
export function createIngestProductTool(deps: IngestProductToolDeps = {}) {
  return tool({
    description:
      'Feltölti vagy frissíti a katalógus (products tábla) termékeit webshop-feedekből (tropicalhome.hu, thesill.com) ' +
      'egy természetes nyelvű kérés alapján, egy külön feltöltő agenttel. ÍR az adatbázisba. ' +
      'Csak akkor hívd, ha a felhasználó kifejezetten termékek betöltését / frissítését kéri; lekérdezésre a runSql-t használd.',
    inputSchema: IngestProductToolInputSchema,
    execute: (input) => executeIngestProduct(input, deps),
  });
}

export const ingestProductTool = createIngestProductTool();
