import { Command } from 'commander';
import { registerAskCommand } from './commands/ask-command.js';

// Keep in sync with apps/cli/package.json "version" field.
const CLI_VERSION = '0.0.1';

const program = new Command();

program.name('plantbase').description('Plantbase CLI').version(CLI_VERSION);

registerAskCommand(program);

// The `ask` command's action calls the (async) agent, so commander must
// await it — `parseAsync` (not `parse`) waits for action handlers that
// return a promise before letting the process exit.
program.parseAsync().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
