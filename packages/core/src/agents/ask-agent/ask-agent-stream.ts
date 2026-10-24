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
  type StepResult,
  type StreamTextResult,
} from 'ai';
import { z } from 'zod';
import '../../config/env.js';
import {
  writeInteractionLog,
  type InteractionLogEntry,
  type InteractionMode,
  type InteractionOutcome,
} from '../../logging/jsonl-logger.js';
import { createStepTimer, type StepTimer } from '../../logging/step-timing.js';
import { logger } from '../../logging/structured-logger.js';
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
import { cachedSystemMessage } from '../prompt-cache.js';
import { anthropicOptionsFor } from './model-options.js';
import {
  VOICE_LIVE_PROMPT_SECTION,
  VOICE_PROMPT_SECTION,
} from './voice-prompt.js';

// The conversation crosses into packages/core from the outside (a browser,
// via apps/web) — an untrusted-input boundary (konvenciok.md "Biztonság"),
// validated fail-fast. `system` is deliberately NOT an accepted role: the
// system prompt is ours alone, a client must not be able to inject one.
// Nor is `tool`, and an earlier assistant turn may only be text: a
// client-sent history could otherwise hand the model forged tool calls and
// "database results" — the agent re-runs its tools when it needs data.
const StreamAskAgentMessageSchema = z.union([
  z.looseObject({ role: z.literal('user') }),
  z.looseObject({
    role: z.literal('assistant'),
    content: z.union([
      z.string(),
      z.array(z.looseObject({ type: z.literal('text') })),
    ]),
  }),
]);

const StreamAskAgentInputSchema = z
  .array(StreamAskAgentMessageSchema)
  .min(1, 'messages must not be empty')
  .refine((messages) => messages.at(-1)?.role === 'user', {
    message: 'the conversation must end with a user message',
  });

/**
 * `text` (default) is the shared prompt as is; `voice` appends the
 * spoken-answer section; `voice-live` is the realtime supervisor: the same
 * spoken-answer section as `voice` plus the voice-live addendum.
 */
export type AskAgentMode = InteractionMode;

export interface StreamAskAgentOptions {
  /** Which prompt variant to run; defaults to `text`. */
  mode?: AskAgentMode;
  /** Injectable for tests; defaults to the real Anthropic provider. */
  model?: LanguageModel;
  /** Called with the JSONL log path once the interaction has been logged. */
  onLogWritten?: (logPath: string) => void;
  /** Stops the model call (and logs the interaction as `aborted`). */
  abortSignal?: AbortSignal;
  /**
   * voice-live only: the client's approximate transcript of what the user
   * said. Logged (marked approximate); never sent to the model.
   */
  clientTranscript?: string;
}

type AskAgentStep = StepResult<AskAgentTools>;

/**
 * Streams the ask-agent's answer to `messages` (the full conversation,
 * ending with the user's latest message). Throws synchronously on invalid
 * input, before any model call. Tool failures do not throw — they reach
 * the stream as tool results/errors, exactly as in `askAgent`.
 *
 * FR4 / architektura.md #4: every interaction is logged exactly once —
 * also when the stream fails (`outcome: 'error'`) or is aborted
 * (`outcome: 'aborted'`), with the steps that had finished by then.
 */
export function streamAskAgent(
  messages: ModelMessage[],
  options: StreamAskAgentOptions = {},
): StreamTextResult<AskAgentTools, never> {
  StreamAskAgentInputSchema.parse(messages);

  const mode = options.mode ?? 'text';
  const system = systemPromptFor(mode);
  const timer = createStepTimer();
  const logOnce = createInteractionLogger(
    messages,
    system,
    { mode, clientTranscript: options.clientTranscript, timer },
    options.onLogWritten,
  );
  // onError gets no steps from the SDK, so the finished ones are kept here.
  let finishedSteps: readonly AskAgentStep[] = [];

  return streamText({
    model: options.model ?? anthropic(MODEL_ID),
    messages: [cachedSystemMessage(system), ...messages],
    // Only our own (cached) system message is in `messages`: the input schema
    // rejects any client-sent system message.
    allowSystemInMessages: true,
    tools: timer.wrapTools(ASK_AGENT_TOOLS),
    maxOutputTokens: MAX_TOKENS,
    stopWhen: [stepCountIs(MAX_ITERATIONS), hasUnknownToolRequest],
    abortSignal: options.abortSignal,
    ...providerOptionsFor(mode),
    onStepFinish: (step) => {
      timer.stepFinished();
      finishedSteps = [...finishedSteps, step];
    },
    // After an error the SDK may still call onFinish (when a step had
    // finished before it); logOnce keeps the first — the error — entry.
    onError: ({ error }) =>
      logOnce({
        outcome: 'error',
        steps: finishedSteps,
        error: errorMessage(error),
      }),
    onAbort: ({ steps }) => logOnce({ outcome: 'aborted', steps }),
    onFinish: ({ steps }) => logOnce({ outcome: 'ok', steps }),
  });
}

interface LogRequest {
  outcome: InteractionOutcome;
  steps: readonly AskAgentStep[];
  error?: string;
}

/**
 * Returns a logger that writes the interaction's JSONL entry on its first
 * call only — the SDK can fire more than one of onError/onAbort/onFinish
 * for the same interaction. A logging failure must not break an answer the
 * user is receiving, so it is reported server-side instead of thrown.
 */
function createInteractionLogger(
  messages: ModelMessage[],
  system: string,
  extras: LogExtras,
  onLogWritten: ((logPath: string) => void) | undefined,
): (request: LogRequest) => Promise<void> {
  let isLogged = false;

  return async (request) => {
    if (isLogged) {
      return;
    }
    isLogged = true;
    try {
      const logPath = await writeInteractionLog(
        buildLogEntry(messages, system, extras, request),
      );
      onLogWritten?.(logPath);
    } catch (error: unknown) {
      logger.error('ask_agent.log_write_failed', { error });
    }
  };
}

interface LogExtras {
  mode: AskAgentMode;
  clientTranscript: string | undefined;
  timer: StepTimer;
}

function buildLogEntry(
  messages: ModelMessage[],
  system: string,
  extras: LogExtras,
  { outcome, steps, error }: LogRequest,
): Omit<InteractionLogEntry, 'timestamp'> {
  const lastStep = steps.at(-1);
  const text = lastStep?.text ?? '';

  return {
    system,
    messages: [...messages, ...(lastStep?.response.messages ?? [])],
    response: text,
    usage: {
      inputTokens: sumTokens(steps, 'inputTokens'),
      outputTokens: sumTokens(steps, 'outputTokens'),
    },
    sqlCalls: extractSqlCalls(extractToolCalls(steps)),
    escalated: text.startsWith(ESCALATE_PREFIX),
    outcome,
    mode: extras.mode,
    timings: extras.timer.snapshot(),
    ...(extras.clientTranscript === undefined
      ? {}
      : {
          clientTranscript: {
            text: extras.clientTranscript,
            approximate: true as const,
          },
        }),
    ...(error === undefined ? {} : { error }),
  };
}

function sumTokens(
  steps: readonly AskAgentStep[],
  field: 'inputTokens' | 'outputTokens',
): number {
  return steps.reduce((total, step) => total + (step.usage[field] ?? 0), 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function systemPromptFor(mode: AskAgentMode): string {
  if (mode === 'text') {
    return ASK_AGENT_SYSTEM_PROMPT;
  }
  return mode === 'voice-live'
    ? ASK_AGENT_SYSTEM_PROMPT + VOICE_PROMPT_SECTION + VOICE_LIVE_PROMPT_SECTION
    : ASK_AGENT_SYSTEM_PROMPT + VOICE_PROMPT_SECTION;
}

function providerOptionsFor(mode: AskAgentMode) {
  const providerOptions = anthropicOptionsFor(mode);
  return providerOptions === undefined ? {} : { providerOptions };
}
