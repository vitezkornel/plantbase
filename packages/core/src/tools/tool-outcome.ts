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
// back to the model as a tool result so it can explain itself gracefully
// (see run-sql/sql-guard.ts and run-sql/run-sql-tool.ts for the concrete
// case this exists for). Each tool is built with the `ai` package's own
// `tool()` helper (Zod `inputSchema` in, model-facing JSON Schema derived
// automatically) and registered by name as a key in the `tools` record
// passed into `generateText` — that record itself *is* the dispatch
// registry (konvenciok.md: "Ne legyen központi dispatch/registry, amit
// párhuzamosan kell karbantartani."), so no separate `AgentTool` wrapper
// type is needed any more.

export type ToolOutcome =
  { ok: true; data: unknown } | { ok: false; error: string };
