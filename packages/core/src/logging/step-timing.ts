// packages/core/src/logging/step-timing.ts
//
// Step timings for the JSONL interaction log: when each model round and each
// tool call started and ended (ms since the interaction started), so a slow
// answer can be attributed to the model or to a tool. A tool call that never
// returned shows up with `endMs: null` in a trailing `unfinished` step.
// Timing only — no content, so nothing user-specific beyond tool names.

export interface ToolTiming {
  name: string;
  startMs: number;
  endMs: number | null;
}

export interface StepTiming {
  /** The previous step's end (0 for the first): model call plus its tools. */
  startMs: number;
  endMs: number;
  tools: ToolTiming[];
  /** Set on a trailing step that was still running when the log was cut. */
  unfinished?: true;
}

export interface InteractionTimings {
  totalMs: number;
  steps: StepTiming[];
}

export interface StepTimer {
  /** Returns the tools with every `execute` timed; other fields untouched. */
  wrapTools<T extends Record<string, unknown>>(tools: T): T;
  /** Call when a step (model round + its tool calls) has finished. */
  stepFinished(): void;
  snapshot(): InteractionTimings;
}

type Execute = (...args: unknown[]) => unknown;

export function createStepTimer(now: () => number = Date.now): StepTimer {
  const startedAt = now();
  const rel = (): number => now() - startedAt;
  const steps: StepTiming[] = [];
  let pending: ToolTiming[] = [];
  let lastEnd = 0;

  const wrapTool = (name: string, tool: unknown): unknown => {
    if (
      typeof tool !== 'object' ||
      tool === null ||
      !('execute' in tool) ||
      typeof tool.execute !== 'function'
    ) {
      return tool;
    }
    const execute = tool.execute as Execute;
    return {
      ...tool,
      execute: async (...args: unknown[]) => {
        const timing: ToolTiming = { name, startMs: rel(), endMs: null };
        pending.push(timing);
        try {
          return await execute.apply(tool, args);
        } finally {
          timing.endMs = rel();
        }
      },
    };
  };

  return {
    wrapTools: <T extends Record<string, unknown>>(tools: T): T =>
      Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => [name, wrapTool(name, tool)]),
      ) as T,
    stepFinished: () => {
      const endMs = rel();
      steps.push({ startMs: lastEnd, endMs, tools: pending });
      pending = [];
      lastEnd = endMs;
    },
    snapshot: () => {
      const totalMs = rel();
      const finished = steps.map((step) => ({
        ...step,
        tools: step.tools.map((tool) => ({ ...tool })),
      }));
      return {
        totalMs,
        steps:
          pending.length === 0
            ? finished
            : [
                ...finished,
                {
                  startMs: lastEnd,
                  endMs: totalMs,
                  tools: pending.map((tool) => ({ ...tool })),
                  unfinished: true as const,
                },
              ],
      };
    },
  };
}
