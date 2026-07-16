// packages/core/src/tools/tool-outcome.ts
//
// konvenciok.md: "a közös kód eggyel kintebb lakik, a fogalmak szintjén
// (pl. agents/agent-loop.ts, tools/tool-outcome.ts)" — this file lives one
// level above `tools/run-sql/` because it's shared shape any future tool
// (not just `runSql`) would reuse, not something specific to SQL.
//
// A tool's execution can fail for reasons the MODEL should hear about and
// react to (bad input, a guard rejection, a DB error) — those are not
// exceptions to throw and crash the request; they are normal outcomes fed
// back to the model as a `tool_result` so it can explain itself gracefully
// (see run-sql/sql-guard.ts and run-sql/run-sql-tool.ts for the concrete
// case this exists for). `AgentTool` bundles a tool's Anthropic-facing
// definition with the function that actually runs it, so `agent-loop.ts`
// can dispatch by name without a separate central registry — the `tools`
// array passed into the loop *is* the registry (konvenciok.md: "Ne legyen
// központi dispatch/registry, amit párhuzamosan kell karbantartani.").

import type Anthropic from '@anthropic-ai/sdk';

export type ToolOutcome =
  { ok: true; data: unknown } | { ok: false; error: string };

export interface AgentTool {
  /** The Anthropic-facing tool definition (name, description, input schema). */
  definition: Anthropic.Tool;
  /** Runs the tool for one `tool_use` block's (unknown, unvalidated) input. */
  execute: (input: unknown) => Promise<ToolOutcome>;
}
