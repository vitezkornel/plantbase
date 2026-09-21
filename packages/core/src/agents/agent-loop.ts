import {
  generateText,
  NoSuchToolError,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import type { ToolOutcome } from '../tools/tool-outcome.js';

// Shared loop core (konvenciok.md: "a közös kód eggyel kintebb lakik" —
// this sits one directory above any specific agent, e.g. `ask-agent/`).
//
// A thin wrapper around the `ai` package's own multi-step tool-use loop
// (`generateText` + `stopWhen`): the model is called, `tool-call` requests
// are dispatched to the matching entry in `tools` (by name — the `tools`
// record passed in IS the dispatch table; no separate central registry,
// per konvenciok.md), tool results are appended, and the model is called
// again — repeat until a normal end-of-turn or the max-iteration cap is
// hit. The wrapper stays because it keeps two behaviors the SDK itself
// leaves as silent defaults: throwing on a genuine max-iteration cutoff,
// and throwing when the model asks for a tool name we never registered
// (an internal wiring bug, not something a well-behaved agent should ever
// hit) — everything else (a tool's own `{ ok: false, error }` outcome, or
// even an accidental throw inside a tool's `execute`) the SDK already
// resolves gracefully into a tool result the model can read and react to.

// Sane safety cap so a misbehaving model (or a tool that keeps returning
// something the model wants to retry forever) can't loop indefinitely.
// One user turn realistically needs at most a couple of `runSql` calls
// (generate → run → maybe refine → run again → answer); 6 rounds gives
// comfortable headroom above that without risking a runaway/expensive loop.
const MAX_ITERATIONS = 6;

export interface AgentLoopInput {
  model: LanguageModel;
  maxTokens: number;
  system: string;
  messages: ModelMessage[];
  /** Registered tools, keyed by name. Omit/empty = no tools. */
  tools?: ToolSet;
}

/** One tool call made during the loop — for callers that want to log it (FR4). */
export interface ToolCallRecord {
  name: string;
  input: unknown;
  outcome: ToolOutcome;
}

export interface AgentLoopResult {
  /** Full message transcript, including everything the model generated. */
  messages: ModelMessage[];
  /** The model's final text answer. */
  finalText: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Every tool call made across all iterations of this loop, in order. */
  toolCalls: ToolCallRecord[];
}

/**
 * Runs the agent loop: sends `messages` (+ `system`, `tools`) to the model
 * and keeps dispatching tool-call requests to the matching entry in
 * `tools` — appending each tool result and calling the model again — until
 * it reaches a normal end-of-turn or `MAX_ITERATIONS` is hit.
 *
 * Throws only for conditions a well-behaved, correctly-wired agent should
 * never hit: an unrecognized tool name (including "no tools registered at
 * all but the model asked for one"), the iteration cap, or an empty final
 * answer. A tool's own failures (bad input, a guard rejection, a DB error,
 * or even an uncaught exception in `execute`) do NOT throw — the `ai`
 * package resolves them into a normal tool result so the model can explain
 * itself gracefully instead of the whole request crashing.
 */
export async function runAgentLoop(
  input: AgentLoopInput,
): Promise<AgentLoopResult> {
  const { model, maxTokens, system, messages, tools } = input;

  const result = await generateText({
    model,
    system,
    messages,
    tools,
    maxOutputTokens: maxTokens,
    stopWhen: stepCountIs(MAX_ITERATIONS),
  });

  assertNoUnknownToolRequests(result.steps);

  if (result.finishReason === 'tool-calls' && result.steps.length >= MAX_ITERATIONS) {
    throw new Error(
      `Agent loop exceeded the maximum of ${MAX_ITERATIONS} iterations without reaching a final answer.`,
    );
  }

  if (result.text.trim() === '') {
    throw new Error(
      `Model response had no text content (finishReason: ${result.finishReason}).`,
    );
  }

  return {
    messages: [...messages, ...result.response.messages],
    finalText: result.text,
    usage: {
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
    },
    toolCalls: extractToolCalls(result.steps),
  };
}

type GenerateTextSteps = Awaited<ReturnType<typeof generateText>>['steps'];

/**
 * The model is only ever offered the tool names in `tools`, so it asking
 * for anything else means our own wiring is broken (a registration typo),
 * not a normal, model-recoverable mistake — fail loudly instead of letting
 * the model quietly paper over a bug in our code.
 */
function assertNoUnknownToolRequests(steps: GenerateTextSteps): void {
  for (const step of steps) {
    for (const part of step.content) {
      if (part.type === 'tool-call' && NoSuchToolError.isInstance(part.error)) {
        throw new Error(`Model requested unknown tool "${part.toolName}".`);
      }
    }
  }
}

function extractToolCalls(steps: GenerateTextSteps): ToolCallRecord[] {
  const records: ToolCallRecord[] = [];

  for (const step of steps) {
    for (const call of step.toolCalls) {
      const matchingResult = step.toolResults.find(
        (candidate) => candidate.toolCallId === call.toolCallId,
      );
      const outcome: ToolOutcome =
        matchingResult && 'output' in matchingResult
          ? (matchingResult.output as ToolOutcome)
          : { ok: false, error: 'Tool call did not produce a result.' };

      records.push({ name: call.toolName, input: call.input, outcome });
    }
  }

  return records;
}
