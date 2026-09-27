import type { Command } from 'commander';
import {
  adminAgent as defaultAdminAgent,
  closeAdminConnections,
} from 'core/admin';

// `admin` is the only CLI surface of the admin agent (ask-agent tools +
// the write-capable ingestProduct tool). The `ask` command and the
// customer-chat app keep using the read-only ask-agent from plain `core`.

/** The slice of core's AdminAgentResult this command prints. */
export interface AdminCommandResult {
  answer: string;
  toolCalls: string[];
  logPath: string;
}

export type AdminAgentFn = (request: string) => Promise<AdminCommandResult>;

/** Injectable for tests; defaults to the real agent from `core/admin`. */
export interface AdminCommandDeps {
  adminAgent?: AdminAgentFn;
  closeConnections?: () => Promise<void>;
}

async function adminAndPrint(
  request: string,
  deps: AdminCommandDeps,
): Promise<void> {
  const adminAgent = deps.adminAgent ?? defaultAdminAgent;
  const closeConnections = deps.closeConnections ?? closeAdminConnections;
  try {
    const result = await adminAgent(request);
    console.log(result.answer);
    console.log(
      `\n(toolok: ${result.toolCalls.join(' → ') || 'nincs'} · log: ${result.logPath})`,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  } finally {
    await closeConnections();
  }
}

/**
 * Registers `admin "<kérés>"`: one-shot admin session — catalog questions
 * like `ask`, plus product loading via the nested ingest agent
 * (e.g. `pnpm cli admin "tölts be 3 fikuszt"`). May write to the DB.
 */
export function registerAdminCommand(
  program: Command,
  deps: AdminCommandDeps = {},
): void {
  program
    .command('admin <request>')
    .description(
      'Adminisztrátori agent: katalógus-kérdések, plusz termékek betöltése webshop-feedekből (ingestProduct). Írhat az adatbázisba.',
    )
    .action((request: string) => adminAndPrint(request, deps));
}
