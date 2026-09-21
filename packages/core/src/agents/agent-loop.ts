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
    // The unknown-tool condition stops the loop right after the offending
    // step instead of letting the SDK spend one more model round-trip
    // trying to let the model recover from our own wiring bug.
    stopWhen: [stepCountIs(MAX_ITERATIONS), hasUnknownToolRequest],
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
type GenerateTextStep = GenerateTextSteps[number];
type StepContentPart = GenerateTextStep['content'][number];

function isUnknownToolCall(
  part: StepContentPart,
): part is Extract<StepContentPart, { type: 'tool-call' }> {
  return part.type === 'tool-call' && NoSuchToolError.isInstance(part.error);
}

/**
 * A `StopCondition` (see `stopWhen` above): stop the multi-step loop right
 * after a step where the model requested an unregistered tool, instead of
 * spending one more model round-trip letting the SDK's default "feed the
 * error back and let the model retry" behavior play out — this is our own
 * wiring bug, not something the model can meaningfully recover from.
 */
function hasUnknownToolRequest({ steps }: { steps: GenerateTextSteps }): boolean {
  const lastStep = steps.at(-1);
  return lastStep !== undefined && lastStep.content.some(isUnknownToolCall);
}

/**
 * The model is only ever offered the tool names in `tools`, so it asking
 * for anything else means our own wiring is broken (a registration typo),
 * not a normal, model-recoverable mistake — fail loudly instead of letting
 * the model quietly paper over a bug in our code.
 */
function assertNoUnknownToolRequests(steps: GenerateTextSteps): void {
  for (const step of steps) {
    for (const part of step.content) {
      if (isUnknownToolCall(part)) {
        throw new Error(`Model requested unknown tool "${part.toolName}".`);
      }
    }
  }
}

/**
 * Reconstructs one tool call's outcome by scanning the step's `content`
 * directly (rather than the higher-level `toolResults`/`toolCalls`
 * convenience arrays) — a call the `ai` package itself rejected before our
 * tool's `execute` ran (invalid input, a `NoSuchToolError`) never gets a
 * `tool-result` entry, only a `tool-error` one, so relying on `toolResults`
 * alone silently drops the real validation detail behind a placeholder.
 */
function extractToolCalls(steps: GenerateTextSteps): ToolCallRecord[] {
  const records: ToolCallRecord[] = [];

  for (const step of steps) {
    for (const part of step.content) {
      if (part.type !== 'tool-call') continue;

      const resultPart = step.content.find(
        (candidate): candidate is Extract<StepContentPart, { type: 'tool-result' | 'tool-error' }> =>
          (candidate.type === 'tool-result' || candidate.type === 'tool-error') &&
          candidate.toolCallId === part.toolCallId,
      );

      const outcome: ToolOutcome =
        resultPart?.type === 'tool-result'
          ? (resultPart.output as ToolOutcome)
          : {
              ok: false,
              error: resultPart
                ? errorMessage(resultPart.error)
                : 'Tool call did not produce a result.',
            };

      records.push({ name: part.toolName, input: part.input, outcome });
    }
  }

  return records;
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
