import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Shared loop core (konvenciok.md: "a közös kód eggyel kintebb lakik" —
// this sits one directory above any specific agent, e.g. `ask-agent/`).
//
// architektura.md #3: askAgent is a hand-written tool-use loop on top of
// the raw Anthropic SDK, no agent framework. This phase (B Fázis 2) has
// zero tools registered, but the loop is already shaped like a real
// tool-use loop: it calls the model, inspects `stop_reason`, and has a
// dedicated branch for `tool_use`. B Fázis 3 turns that branch into an
// actual dispatch-to-`runSql`-and-continue step; today it just fails
// loudly, since a `tool_use` stop reason with no tools registered would
// otherwise be a silent dead end.

const TextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

export interface AgentLoopInput {
  client: Anthropic;
  model: Anthropic.Model;
  maxTokens: number;
  system: string;
  messages: Anthropic.MessageParam[];
  // No tools yet (B Fázis 2). Kept here, typed and unused, so B Fázis 3
  // can register `runSql` without reshaping this function's signature or
  // its control flow — just passing a non-empty array.
  tools?: Anthropic.Tool[];
}

export interface AgentLoopResult {
  /** Full message transcript, including the assistant's reply appended. */
  messages: Anthropic.MessageParam[];
  /** The model's final text answer. */
  finalText: string;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Runs one turn of the agent loop: sends `messages` (+ `system`) to the
 * model and returns its final text answer once it reaches a normal
 * end-of-turn. If the model asks for a tool (`stop_reason === 'tool_use'`),
 * this throws — there is nothing registered to dispatch to yet.
 */
export async function runAgentLoop(
  input: AgentLoopInput,
): Promise<AgentLoopResult> {
  const { client, model, maxTokens, system, messages, tools } = input;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages,
    ...(tools && tools.length > 0 ? { tools } : {}),
  });

  const transcript: Anthropic.MessageParam[] = [
    ...messages,
    { role: 'assistant', content: response.content },
  ];

  if (response.stop_reason === 'tool_use') {
    // B Fázis 3 will replace this with: dispatch the requested tool(s),
    // append `tool_result` message(s), and loop back into another
    // `messages.create` call — the natural continuation of this same
    // control flow, not a rewrite.
    throw new Error(
      'Model requested a tool (stop_reason: tool_use), but no tools are registered in this phase (B Fázis 2 has no DB access).',
    );
  }

  return {
    messages: transcript,
    finalText: extractFinalText(response),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
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
