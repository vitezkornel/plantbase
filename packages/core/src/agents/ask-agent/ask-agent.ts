import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import '../../config/env.js';
import {
  writeInteractionLog,
  type AgentUsage,
} from '../../logging/jsonl-logger.js';
import { runAgentLoop } from '../agent-loop.js';
import { ASK_AGENT_SYSTEM_PROMPT } from './ask-agent-prompt.js';

const MODEL: Anthropic.Model = 'claude-sonnet-5';
const MAX_TOKENS = 1024;

// The question crosses into packages/core from the outside (CLI argument or
// interactive stdin line) — an external/untrusted-input boundary
// (konvenciok.md "Biztonság"), validated with Zod, fail-fast.
const AskAgentInputSchema = z.object({
  question: z.string().min(1, 'question must not be empty'),
});

export interface AskAgentDeps {
  /** Injectable for tests; defaults to a real Anthropic client. */
  client?: Anthropic;
}

export interface AskAgentResult {
  /** The model's final natural-language answer. */
  answer: string;
  /** Full message array sent to/received from the model (for --show-prompt). */
  messages: Anthropic.MessageParam[];
  /** The system prompt used for this call (for --show-prompt). */
  system: string;
  usage: AgentUsage;
  /** Absolute path of the JSONL log file written for this interaction. */
  logPath: string;
}

/**
 * Plain conversational LLM call — no tools, no DB (B Fázis 2). Framework-
 * agnostic: takes a question string in, returns plain data out. The caller
 * (apps/cli today; a future API/web app later) is responsible for all I/O.
 */
export async function askAgent(
  question: string,
  deps: AskAgentDeps = {},
): Promise<AskAgentResult> {
  const { question: validQuestion } = AskAgentInputSchema.parse({ question });

  const client = deps.client ?? new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: validQuestion },
  ];

  const result = await runAgentLoop({
    client,
    model: MODEL,
    maxTokens: MAX_TOKENS,
    system: ASK_AGENT_SYSTEM_PROMPT,
    messages,
  });

  const logPath = await writeInteractionLog({
    system: ASK_AGENT_SYSTEM_PROMPT,
    messages: result.messages,
    response: result.finalText,
    usage: result.usage,
  });

  return {
    answer: result.finalText,
    messages: result.messages,
    system: ASK_AGENT_SYSTEM_PROMPT,
    usage: result.usage,
    logPath,
  };
}
