import { askAgent as defaultAskAgent, type AskAgentResult } from 'core';
import type { Command } from 'commander';
import * as readline from 'node:readline';

// Re-derived from AskAgentResult rather than importing `@anthropic-ai/sdk`
// directly — the CLI only needs the plain-data shape `askAgent` returns, not
// a dependency on the Anthropic SDK itself (architektura.md #1: apps/cli is
// just an I/O surface over packages/core's plain-data API).
type MessageArray = AskAgentResult['messages'];

const PROMPT = '> ';
const EXIT_KEYWORD = 'exit';

export type AskAgentFn = typeof defaultAskAgent;

export interface AskCommandOptions {
  showPrompt?: boolean;
}

/** Injectable for tests; defaults to the real `askAgent` from `packages/core`. */
export interface AskCommandDeps {
  askAgent?: AskAgentFn;
}

/**
 * FR5 (--show-prompt): prints the full message array sent to/received from
 * the model, plus the system prompt that framed it.
 */
export function formatShowPrompt(
  system: string,
  messages: MessageArray,
): string {
  return [
    '--- show-prompt: system + full message array ---',
    JSON.stringify({ system, messages }, null, 2),
    '--- end show-prompt ---',
  ].join('\n');
}

/**
 * Calls the agent for a single question and prints its answer (and,
 * optionally, the full prompt) to stdout. Errors are reported to stderr
 * with a non-zero exit code rather than throwing past the caller, so an
 * interactive session can keep going after one bad question.
 */
async function askAndPrint(
  question: string,
  options: AskCommandOptions,
  askAgent: AskAgentFn,
): Promise<void> {
  let result: AskAgentResult;
  try {
    result = await askAgent(question);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
    return;
  }

  if (options.showPrompt) {
    console.log(formatShowPrompt(result.system, result.messages));
  }
  console.log(result.answer);
}

/**
 * Runs the interactive `ask` loop: reads lines from stdin via node:readline
 * and sends each one to the agent until the user types "exit". Resolves
 * once the session closes.
 */
function runInteractiveAsk(
  options: AskCommandOptions,
  askAgent: AskAgentFn,
): Promise<void> {
  return new Promise((resolvePromise) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: PROMPT,
    });

    // Lines can arrive faster than the model responds — e.g. fully
    // buffered/piped stdin (the same pattern this project's own manual
    // tests use), or a human pasting several lines at once. Relying on
    // `rl.pause()`/`resume()` timing does NOT reliably prevent two
    // `askAgent` calls from overlapping in that case (observed during
    // manual verification: two piped questions came back printed in the
    // wrong order). Queueing and draining strictly one at a time avoids
    // that regardless of how fast lines arrive.
    const queue: string[] = [];
    let processing = false;
    let closed = false;

    function drain(): void {
      if (processing) {
        return;
      }
      const next = queue.shift();
      if (next === undefined) {
        if (closed) {
          // Let Node exit naturally once the event loop drains, instead
          // of a forced `process.exit(0)` here — calling it while
          // readline/stdin handles are still being torn down crashed
          // with a libuv assertion on Windows ("UV_HANDLE_CLOSING")
          // when observed during manual verification.
          resolvePromise();
        } else {
          rl.prompt();
        }
        return;
      }
      processing = true;
      askAndPrint(next, options, askAgent)
        .catch((error: unknown) => {
          console.error('Unexpected error:', error);
        })
        .finally(() => {
          processing = false;
          drain();
        });
    }

    rl.prompt();

    rl.on('line', (line) => {
      if (line.trim() === EXIT_KEYWORD) {
        closed = true;
        rl.close();
        drain();
        return;
      }
      queue.push(line);
      drain();
    });

    rl.on('close', () => {
      closed = true;
      drain();
    });
  });
}

/**
 * Registers the `ask` subcommand on the given commander program.
 * - `ask "<question>"` — one-shot: calls the agent once, prints the answer,
 *   and exits.
 * - `ask` (no argument) — interactive: node:readline loop, sends each line
 *   to the agent, ends cleanly on "exit".
 * - `--show-prompt` (FR5): also prints the full system prompt + message
 *   array sent to/received from the model.
 */
export function registerAskCommand(
  program: Command,
  deps: AskCommandDeps = {},
): void {
  const askAgent = deps.askAgent ?? defaultAskAgent;

  program
    .command('ask [question]')
    .description(
      'Ask the Plantbase assistant a question. One-shot with an argument; interactive loop without one (type "exit" to quit).',
    )
    .option(
      '--show-prompt',
      'Print the full system prompt and message array sent to the model',
    )
    .action((question: string | undefined, options: AskCommandOptions) => {
      if (question !== undefined) {
        return askAndPrint(question, options, askAgent);
      }
      return runInteractiveAsk(options, askAgent);
    });
}
