import { Command } from 'commander';

// Keep in sync with apps/cli/package.json "version" field.
const CLI_VERSION = '0.0.1';

const program = new Command();

program.name('plantbase').description('Plantbase CLI').version(CLI_VERSION);

program.parse();
