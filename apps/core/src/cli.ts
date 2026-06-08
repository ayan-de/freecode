#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { mcpCommand } from './cli/commands/mcp/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logo = fs.readFileSync(path.join(__dirname, '..', 'src', 'logo.txt'), 'utf-8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const version = packageJson.version;

async function main() {
  // Print logo before yargs to avoid Unicode/formatting corruption
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('\n' + logo.trimEnd() + '\n');
  }

  const argv = await yargs(hideBin(process.argv))
    .scriptName('freecode')
    .usage('$0 [command] [options]')
    .option('h', {
      alias: 'help',
      describe: 'show help',
      type: 'boolean',
    })
    .version(version)
    .command(mcpCommand)
    .demandCommand(1, 'Specify a command')
    .strict()
    .parseAsync();

  // If no MCP command, start the JSON-RPC server (lazy import to avoid loading tools)
  if (!argv._.includes('mcp')) {
    const { startServer } = await import('./server.js');
    startServer();
  }
}

main().catch((e) => {
  console.error('Error:', (e as Error).message);
  process.exit(1);
});