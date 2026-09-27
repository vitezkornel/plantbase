// packages/core/src/agents/admin-agent/admin-agent.ts
//
// The admin agent (`adminAgent`): a third agent, for the CLI `admin`
// command only. It sees the ask-agent's read-only tools AND the
// write-capable `ingestProduct` tool (which runs the whole ingest agent as
// a nested, self-contained loop). It is exported only from the separate
// `core/admin` entry point; the ask-agent (CLI `ask`, customer-chat) is
// untouched and never gets the ingest capability.

import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import { z } from 'zod';
import '../../config/env.js';
import {
  writeInteractionLog,
  type AgentUsage,
  type SqlCallLogEntry,
} from '../../logging/jsonl-logger.js';
import {
  CUSTOMER_PREFERENCES_TOOL_NAME,
  customerPreferencesTool,
} from '../../tools/customer-preferences/customer-preferences-tool.js';
import {
  INGEST_PRODUCT_TOOL_NAME,
  ingestProductTool,
} from '../../tools/ingest-product/ingest-product-tool.js';
import {
  LIST_CATEGORIES_TOOL_NAME,
  listCategoriesTool,
} from '../../tools/list-categories/list-categories-tool.js';
import {
  RUN_SQL_TOOL_NAME,
  runSqlTool,
} from '../../tools/run-sql/run-sql-tool.js';
import {
  SEARCH_KNOWLEDGE_TOOL_NAME,
  searchKnowledgeTool,
} from '../../tools/search-knowledge/search-knowledge-tool.js';
import { runAgentLoop, type ToolCallRecord } from '../agent-loop.js';
import { ADMIN_AGENT_SYSTEM_PROMPT } from './admin-agent-prompt.js';

/** Closes the read-write connection the nested ingest agent may have opened. */
export { closeIngestConnections as closeAdminConnections } from '../../ingest/ingest-agent.js';

const MODEL_ID = 'claude-sonnet-5';
const MAX_TOKENS = 1024;

const AdminAgentInputSchema = z.object({
  request: z.string().min(1, 'request must not be empty'),
});

export interface AdminAgentDeps {
  /** Injectable for tests; defaults to the real Anthropic provider. */
  model?: LanguageModel;
  /** Injectable for tests; defaults to the admin toolset below. */
  tools?: ToolSet;
}

export interface AdminAgentResult {
  answer: string;
  messages: ModelMessage[];
  system: string;
  usage: AgentUsage;
  /** Names of the tools called by the admin agent, in order. */
  toolCalls: string[];
  logPath: string;
}

export async function adminAgent(
  request: string,
  deps: AdminAgentDeps = {},
): Promise<AdminAgentResult> {
  const { request: validRequest } = AdminAgentInputSchema.parse({ request });

  const messages: ModelMessage[] = [{ role: 'user', content: validRequest }];
  const result = await runAgentLoop({
    model: deps.model ?? anthropic(MODEL_ID),
    maxTokens: MAX_TOKENS,
    system: ADMIN_AGENT_SYSTEM_PROMPT,
    messages,
    tools: deps.tools ?? {
      // one-line-per-tool registration (konvenciok.md)
      [RUN_SQL_TOOL_NAME]: runSqlTool,
      [LIST_CATEGORIES_TOOL_NAME]: listCategoriesTool,
      [SEARCH_KNOWLEDGE_TOOL_NAME]: searchKnowledgeTool,
      [CUSTOMER_PREFERENCES_TOOL_NAME]: customerPreferencesTool,
      [INGEST_PRODUCT_TOOL_NAME]: ingestProductTool,
    },
  });

  const logPath = await writeInteractionLog({
    system: ADMIN_AGENT_SYSTEM_PROMPT,
    messages: result.messages,
    response: result.finalText,
    usage: result.usage,
    sqlCalls: extractSqlCalls(result.toolCalls),
    escalated: false,
  });

  return {
    answer: result.finalText,
    messages: result.messages,
    system: ADMIN_AGENT_SYSTEM_PROMPT,
    usage: result.usage,
    toolCalls: result.toolCalls.map((call) => call.name),
    logPath,
  };
}

/** FR4: the runSql calls (SQL text + outcome) for the interaction log. */
function extractSqlCalls(toolCalls: ToolCallRecord[]): SqlCallLogEntry[] {
  return toolCalls
    .filter((call) => call.name === RUN_SQL_TOOL_NAME)
    .map((call) => ({
      sql:
        typeof call.input === 'object' &&
        call.input !== null &&
        'sql' in call.input
          ? String((call.input as { sql: unknown }).sql)
          : JSON.stringify(call.input),
      result: call.outcome,
    }));
}
