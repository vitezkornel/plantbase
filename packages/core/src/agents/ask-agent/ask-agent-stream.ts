// packages/core/src/agents/ask-agent/ask-agent-stream.ts
//
// The ask-agent's STREAMING entry point (`streamAskAgent`), for callers
// that want the answer and the tool steps as they happen (today: apps/web,
// through the `ai` package's UI-message stream). Same agent as `askAgent`
// — same system prompt, same read-only toolset, same step cap and the
// same JSONL interaction log — only the delivery differs: it takes a whole
// conversation (`ModelMessage[]`) instead of one question, and returns the
// `ai` package's `StreamTextResult` instead of awaiting the final answer.
//
// Framework-agnostic (architektura.md #1): no Next.js, no `UIMessage`
// here — converting UI messages to `ModelMessage[]` and turning the result
// into an HTTP response is the caller's job.

import { anthropic } from '@ai-sdk/anthropic';
import {
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type StreamTextResult,
} from 'ai';
import { z } from 'zod';
import '../../config/env.js';
import { writeInteractionLog } from '../../logging/jsonl-logger.js';
import {
  extractToolCalls,
  hasUnknownToolRequest,
  MAX_ITERATIONS,
} from '../agent-loop.js';
import {
  ASK_AGENT_TOOLS,
  ESCALATE_PREFIX,
  extractSqlCalls,
  MAX_TOKENS,
  MODEL_ID,
  type AskAgentTools,
} from './ask-agent.js';
import { ASK_AGENT_SYSTEM_PROMPT } from './ask-agent-prompt.js';

// The conversation crosses into packages/core from the outside (a browser,
// via apps/web) — an untrusted-input boundary (konvenciok.md "Biztonság"),
// validated fail-fast. `system` is deliberately NOT an accepted role: the
// system prompt is ours alone, a client must not be able to inject one.
const StreamAskAgentInputSchema = z
  .array(z.looseObject({ role: z.enum(['user', 'assistant', 'tool']) }))
  .min(1, 'messages must not be empty')
  .refine((messages) => messages.at(-1)?.role === 'user', {
    message: 'the conversation must end with a user message',
  });

export interface StreamAskAgentDeps {
  /** Injectable for tests; defaults to the real Anthropic provider. */
  model?: LanguageModel;
  /** Called with the JSONL log path once the interaction has been logged. */
  onLogWritten?: (logPath: string) => void;
}

/**
 * Streams the ask-agent's answer to `messages` (the full conversation,
 * ending with the user's latest message). Throws synchronously on invalid
 * input, before any model call. Tool failures do not throw — they reach
 * the stream as tool results/errors, exactly as in `askAgent`.
 */
export function streamAskAgent(
  messages: ModelMessage[],
  deps: StreamAskAgentDeps = {},
): StreamTextResult<AskAgentTools, never> {
  StreamAskAgentInputSchema.parse(messages);

  return streamText({
    model: deps.model ?? anthropic(MODEL_ID),
    system: ASK_AGENT_SYSTEM_PROMPT,
    messages,
    tools: ASK_AGENT_TOOLS,
    maxOutputTokens: MAX_TOKENS,
    stopWhen: [stepCountIs(MAX_ITERATIONS), hasUnknownToolRequest],
    onFinish: async ({ text, steps, totalUsage, response }) => {
      // FR4: the same interaction log as askAgent. A logging failure must
      // not break an answer the user has already received, so it is
      // reported server-side instead of thrown into the finished stream.
      try {
        const logPath = await writeInteractionLog({
          system: ASK_AGENT_SYSTEM_PROMPT,
          messages: [...messages, ...response.messages],
          response: text,
          usage: {
            inputTokens: totalUsage.inputTokens ?? 0,
            outputTokens: totalUsage.outputTokens ?? 0,
          },
          sqlCalls: extractSqlCalls(extractToolCalls(steps)),
          escalated: text.startsWith(ESCALATE_PREFIX),
        });
        deps.onLogWritten?.(logPath);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `streamAskAgent: failed to write the interaction log: ${message}`,
        );
      }
    },
  });
}
