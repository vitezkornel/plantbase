import type { Command } from 'commander';
import * as readline from 'node:readline';

const PROMPT = '> ';
const EXIT_KEYWORD = 'exit';

/**
 * Formats a single piece of user input as the CLI's echo response.
 * Phase 1 has no LLM/DB behind this yet — it only proves the CLI plumbing.
 */
export function formatEcho(input: string): string {
  return `Echo: ${input}`;
}

/**
 * Runs the interactive `ask` loop: reads lines from stdin via node:readline
 * and echoes each one back until the user types "exit".
 */
function runInteractiveAsk(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
  });

  rl.prompt();

  rl.on('line', (line) => {
    if (line.trim() === EXIT_KEYWORD) {
      rl.close();
      return;
    }
    console.log(formatEcho(line));
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

/**
 * Registers the `ask` subcommand on the given commander program.
 * - `ask "<question>"` — one-shot: prints the echo once and exits.
 * - `ask` (no argument) — interactive: node:readline loop, echoes each
 *   line, ends cleanly on "exit".
 */
export function registerAskCommand(program: Command): void {
  program
    .command('ask [question]')
    .description(
      'Ask a question (echo-only for now). One-shot with an argument; interactive loop without one (type "exit" to quit).',
    )
    .action((question?: string) => {
      if (question !== undefined) {
        console.log(formatEcho(question));
        return;
      }
      runInteractiveAsk();
    });
}
