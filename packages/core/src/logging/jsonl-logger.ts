import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { REPO_ROOT } from '../config/repo-root.js';
import type { ToolOutcome } from '../tools/tool-outcome.js';

// FR4 (now COMPLETE — see docs/brs-plantbase.md): "minden interakciót
// logol (logs/<timestamp>.jsonl): system prompt, üzenetek, generált SQL,
// eredmény, válasz, token-felhasználás." B Fázis 2 logged system prompt,
// messages, response, and token usage; B Fázis 3 adds the generated SQL
// and its result via `sqlCalls`.
//
// Interpretation of "logs/<timestamp>.jsonl": one JSONL file per
// askAgent invocation (not one growing session file) — each file happens
// to contain exactly one line right now, but the shape stays a JSONL file
// (not bare JSON) so a future multi-turn interaction could append more
// than one entry to the same file without a format change.
//
// This lives in packages/core (not apps/cli) per architektura.md #6:
// naplózás is core's responsibility, not the CLI's.

// See config/repo-root.ts for why this is resolved from process.cwd() (via
// REPO_ROOT) rather than import.meta.url/__dirname.
const LOGS_DIR = resolve(REPO_ROOT, 'logs');

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * One `runSql` call made during an interaction: the SQL text the model
 * generated, and the outcome (rows on success, or the guard/DB error on
 * failure). An array, not a single field — the agent-loop can in principle
 * call a tool more than once per question (a refined follow-up query),
 * even though today's typical interaction calls it once.
 */
export interface SqlCallLogEntry {
  sql: string;
  result: ToolOutcome;
}

export interface InteractionLogEntry {
  timestamp: string;
  system: string;
  messages: Anthropic.MessageParam[];
  response: string;
  usage: AgentUsage;
  sqlCalls: SqlCallLogEntry[];
}

/**
 * Writes one JSONL log entry (a single line, `logs/<timestamp>.jsonl`) for
 * one `askAgent` interaction. Returns the absolute path of the file written.
 */
export async function writeInteractionLog(
  entry: Omit<InteractionLogEntry, 'timestamp'>,
): Promise<string> {
  await mkdir(LOGS_DIR, { recursive: true });

  // ISO timestamps contain `:` which NTFS (Windows) rejects in filenames —
  // sanitize to a filesystem-safe form on every platform.
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  const logPath = resolve(LOGS_DIR, `${safeTimestamp}.jsonl`);

  const fullEntry: InteractionLogEntry = { timestamp, ...entry };
  await writeFile(logPath, `${JSON.stringify(fullEntry)}\n`, 'utf-8');

  return logPath;
}
