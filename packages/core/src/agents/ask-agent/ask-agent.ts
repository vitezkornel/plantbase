import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel, ModelMessage } from 'ai';
import { z } from 'zod';
import '../../config/env.js';
import {
  writeInteractionLog,
  type AgentUsage,
  type SqlCallLogEntry,
} from '../../logging/jsonl-logger.js';
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
import { ASK_AGENT_SYSTEM_PROMPT } from './ask-agent-prompt.js';

const MODEL_ID = 'claude-sonnet-5';
const MAX_TOKENS = 1024;
const ESCALATE_PREFIX = '[ESCALATE] ';

// The question crosses into packages/core from the outside (CLI argument or
// interactive stdin line) — an external/untrusted-input boundary
// (konvenciok.md "Biztonság"), validated with Zod, fail-fast.
const AskAgentInputSchema = z.object({
  question: z.string().min(1, 'question must not be empty'),
});

export interface AskAgentDeps {
  /** Injectable for tests; defaults to the real Anthropic provider. */
  model?: LanguageModel;
}

export interface AskAgentResult {
  /** The model's final natural-language answer. */
  answer: string;
  /** Full message array sent to/received from the model (for --show-prompt). */
  messages: ModelMessage[];
  /** The system prompt used for this call (for --show-prompt). */
  system: string;
  usage: AgentUsage;
  /** Absolute path of the JSONL log file written for this interaction. */
  logPath: string;
  /** True if the agent handed this off to a human (`[ESCALATE] ` prefix). */
  escalated: boolean;
}

/**
 * The Plantbase catalog assistant (FR2/FR3): translates the question to
 * SQL, runs it read-only via the `runSql` tool, and answers in natural
 * language from the result — a multistep agent-loop, not a single call.
 * Framework-agnostic: takes a question string in, returns plain data out.
 * The caller (apps/cli today; a future API/web app later) is responsible
 * for all I/O.
 */
export async function askAgent(
  question: string,
  deps: AskAgentDeps = {},
): Promise<AskAgentResult> {
  const { question: validQuestion } = AskAgentInputSchema.parse({ question });

  const model = deps.model ?? anthropic(MODEL_ID);
  const messages: ModelMessage[] = [{ role: 'user', content: validQuestion }];

  const result = await runAgentLoop({
    model,
    maxTokens: MAX_TOKENS,
    system: ASK_AGENT_SYSTEM_PROMPT,
    messages,
    tools: {
      // one-line-per-tool registration (konvenciok.md)
      [RUN_SQL_TOOL_NAME]: runSqlTool,
      [LIST_CATEGORIES_TOOL_NAME]: listCategoriesTool,
      [SEARCH_KNOWLEDGE_TOOL_NAME]: searchKnowledgeTool,
    },
  });

  const escalated = result.finalText.startsWith(ESCALATE_PREFIX);
  const answer = escalated
    ? result.finalText.slice(ESCALATE_PREFIX.length).trim()
    : result.finalText;

  const logPath = await writeInteractionLog({
    system: ASK_AGENT_SYSTEM_PROMPT,
    messages: result.messages,
    response: result.finalText,
    usage: result.usage,
    sqlCalls: extractSqlCalls(result.toolCalls),
    escalated,
  });

  return {
    answer,
    messages: result.messages,
    system: ASK_AGENT_SYSTEM_PROMPT,
    usage: result.usage,
    logPath,
    escalated,
  };
}

/**
 * Narrows the agent-loop's generic `toolCalls` (any tool, unknown input)
 * down to the `{ sql, result }` shape FR4's logging requires — `askAgent`
 * is the place that knows its only registered tool is `runSql` and what
 * its input field is called; `runAgentLoop` itself stays tool-agnostic.
 */
function extractSqlCalls(toolCalls: ToolCallRecord[]): SqlCallLogEntry[] {
  return toolCalls
    .filter((call) => call.name === RUN_SQL_TOOL_NAME)
    .map((call) => ({
      sql: extractSqlText(call.input),
      result: call.outcome,
    }));
}

/**
 * Best-effort extraction of the `sql` string from a `runSql` tool call's
 * raw (LLM-produced, unvalidated) input — falls back to a JSON dump so a
 * malformed call (which the tool's own Zod schema will separately have
 * rejected, see run-sql-schema.ts) still ends up somewhere in the log
 * rather than silently vanishing.
 */
function extractSqlText(input: unknown): string {
  if (
    typeof input === 'object' &&
    input !== null &&
    'sql' in input &&
    typeof (input as { sql: unknown }).sql === 'string'
  ) {
    return (input as { sql: string }).sql;
  }
  return JSON.stringify(input);
}
