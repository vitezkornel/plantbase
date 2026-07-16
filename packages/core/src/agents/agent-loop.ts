import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AgentTool, ToolOutcome } from '../tools/tool-outcome.js';

// Shared loop core (konvenciok.md: "a közös kód eggyel kintebb lakik" —
// this sits one directory above any specific agent, e.g. `ask-agent/`).
//
// architektura.md #3: askAgent is a hand-written tool-use loop on top of
// the raw Anthropic SDK, no agent framework. B Fázis 2 had zero tools
// registered, so this loop was single-pass. B Fázis 3 registers `runSql`,
// so the loop now actually iterates: call the model → if it asks for a
// tool, dispatch to the matching entry in `tools` (by name — the `tools`
// array passed in IS the dispatch table; no separate central registry,
// per konvenciok.md), append the tool result(s), call the model again →
// repeat until a normal end-of-turn or the max-iteration cap is hit.

const TextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const ToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

// Sane safety cap so a misbehaving model (or a tool that keeps returning
// something the model wants to retry forever) can't loop indefinitely.
// One user turn realistically needs at most a couple of `runSql` calls
// (generate → run → maybe refine → run again → answer); 6 rounds gives
// comfortable headroom above that without risking a runaway/expensive loop.
const MAX_ITERATIONS = 6;

export interface AgentLoopInput {
  client: Anthropic;
  model: Anthropic.Model;
  maxTokens: number;
  system: string;
  messages: Anthropic.MessageParam[];
  /** Registered tools (definition + executor). Omit/empty = no tools. */
  tools?: AgentTool[];
}

/** One tool call made during the loop — for callers that want to log it (FR4). */
export interface ToolCallRecord {
  name: string;
  input: unknown;
  outcome: ToolOutcome;
}

export interface AgentLoopResult {
  /** Full message transcript, including the assistant's reply appended. */
  messages: Anthropic.MessageParam[];
  /** The model's final text answer. */
  finalText: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Every tool call made across all iterations of this loop, in order. */
  toolCalls: ToolCallRecord[];
}

/**
 * Runs the agent loop: sends `messages` (+ `system`, `tools`) to the model
 * and keeps dispatching `tool_use` requests to the matching entry in
 * `tools` — appending each `tool_result` and calling the model again —
 * until it reaches a normal end-of-turn or `MAX_ITERATIONS` is hit.
 *
 * Throws only for conditions a well-behaved, correctly-wired agent should
 * never hit (no tools registered at all but the model asked for one; an
 * unrecognized tool name; the iteration cap). A tool's own failures (bad
 * input, a guard rejection, a DB error) do NOT throw — they come back from
 * `tool.execute()` as `{ ok: false, error }` and are fed to the model as a
 * normal (if `is_error`-flagged) `tool_result`, so the model can explain
 * itself gracefully instead of the whole request crashing.
 */
export async function runAgentLoop(
  input: AgentLoopInput,
): Promise<AgentLoopResult> {
  const { client, model, maxTokens, system, messages, tools } = input;

  let transcript: Anthropic.MessageParam[] = [...messages];
  const toolCalls: ToolCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: transcript,
      ...(tools && tools.length > 0
        ? { tools: tools.map((tool) => tool.definition) }
        : {}),
    });

    transcript = [
      ...transcript,
      { role: 'assistant', content: response.content },
    ];
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;

    if (response.stop_reason !== 'tool_use') {
      return {
        messages: transcript,
        finalText: extractFinalText(response),
        usage: { inputTokens, outputTokens },
        toolCalls,
      };
    }

    if (!tools || tools.length === 0) {
      throw new Error(
        'Model requested a tool (stop_reason: tool_use), but no tools are registered.',
      );
    }

    const toolResultContent = await dispatchToolUseBlocks(
      response.content,
      tools,
      toolCalls,
    );
    transcript = [...transcript, { role: 'user', content: toolResultContent }];
  }

  throw new Error(
    `Agent loop exceeded the maximum of ${MAX_ITERATIONS} iterations without reaching a final answer.`,
  );
}

/**
 * Runs every `tool_use` block in one model response against the matching
 * registered tool and returns the `tool_result` blocks to send back.
 */
async function dispatchToolUseBlocks(
  content: Anthropic.ContentBlock[],
  tools: AgentTool[],
  toolCalls: ToolCallRecord[],
): Promise<Anthropic.ToolResultBlockParam[]> {
  const toolUseBlocks = content
    .filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    )
    .map((block) => ToolUseBlockSchema.parse(block));

  const results: Anthropic.ToolResultBlockParam[] = [];

  for (const block of toolUseBlocks) {
    const tool = tools.find(
      (candidate) => candidate.definition.name === block.name,
    );
    if (!tool) {
      throw new Error(`Model requested unknown tool "${block.name}".`);
    }

    const outcome = await tool.execute(block.input);
    toolCalls.push({ name: block.name, input: block.input, outcome });

    results.push({
      type: 'tool_result',
      tool_use_id: block.id,
      content: JSON.stringify(
        outcome.ok ? outcome.data : { error: outcome.error },
      ),
      is_error: !outcome.ok,
    });
  }

  return results;
}

/**
 * Extracts and concatenates the text blocks from a model response.
 * The response body is untrusted, external input (konvenciok.md
 * "Biztonság") — validated with Zod rather than blindly trusted via
 * TypeScript types alone.
 */
function extractFinalText(message: Anthropic.Message): string {
  const textBlocks = message.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  );

  if (textBlocks.length === 0) {
    throw new Error(
      `Model response had no text content (stop_reason: ${message.stop_reason ?? 'unknown'}).`,
    );
  }

  return textBlocks
    .map((block) => TextBlockSchema.parse(block).text)
    .join('\n');
}
