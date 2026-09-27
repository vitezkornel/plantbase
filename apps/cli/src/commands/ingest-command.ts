import type { Command } from 'commander';
import {
  closeIngestConnections,
  ingestProduct as defaultIngestProduct,
} from 'core/ingest';

// The ingest agent lives behind the separate `core/ingest` entry point (the
// `ask` command imports plain `core`, which never exports it). The
// read-write Prisma client is only created on the first write, so an `ask`
// run never opens a read-write connection.

/** The slice of core's IngestProductResult this command prints. */
export interface IngestCommandResult {
  answer: string;
  toolCalls: string[];
  logPath: string;
}

export type IngestProductFn = (request: string) => Promise<IngestCommandResult>;

/** Injectable for tests; defaults to the real agent from `core/ingest`. */
export interface IngestCommandDeps {
  ingestProduct?: IngestProductFn;
  closeConnections?: () => Promise<void>;
}

async function ingestAndPrint(
  request: string,
  deps: IngestCommandDeps,
): Promise<void> {
  const ingestProduct = deps.ingestProduct ?? defaultIngestProduct;
  const closeConnections = deps.closeConnections ?? closeIngestConnections;
  try {
    const result = await ingestProduct(request);
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
 * Registers `ingest "<kérés>"`: runs the feed-ingest agent once, e.g.
 * `pnpm cli ingest "frissítsd a fikuszokat a tropicalhome-ról"`.
 * Writes to the catalog (read-write DATABASE_URL).
 */
export function registerIngestCommand(
  program: Command,
  deps: IngestCommandDeps = {},
): void {
  program
    .command('ingest <request>')
    .description(
      'Frissíti a products táblát webshop-feedekből (tropicalhome.hu, thesill.com) a természetes nyelvű kérés szerint. Ír az adatbázisba.',
    )
    .action((request: string) => ingestAndPrint(request, deps));
}
