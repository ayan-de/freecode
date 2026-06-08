#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadMcpConfig, saveMcpServer, removeMcpServer } from './mcp/config.js';
import { connectMcpServer, disconnectMcpServer } from './mcp/init.js';
import type { McpServer } from './mcp/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logo = fs.readFileSync(path.join(__dirname, 'logo.txt'), 'utf-8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const version = packageJson.version;

function getConfigDir(): string {
  return path.join(os.homedir(), '.freecode');
}

async function listMcpServers() {
  const config = await loadMcpConfig(getConfigDir());
  console.log('\nMCP Servers:');
  console.log('┌────────────────┬─────────┬──────────────┐');
  console.log('│ Name           │ Type    │ Enabled      │');
  console.log('├────────────────┼─────────┼──────────────┤');

  if (config.servers.length === 0) {
    console.log('│ (no servers configured)                    │');
  }

  for (const server of config.servers) {
    const name = server.name.padEnd(14);
    const type = server.type.padEnd(7);
    const enabled = server.enabled ? 'yes' : 'no';
    console.log(`│ ${name} │ ${type} │ ${enabled.padEnd(12)} │`);
  }
  console.log('└────────────────┴─────────┴──────────────┘\n');
}

async function addMcpServer(name: string, type: 'local' | 'remote', command: string) {
  const server: McpServer = {
    name,
    type,
    command: command.split(' '),
    enabled: true,
    timeout: 5000,
  };
  await saveMcpServer(getConfigDir(), server);
  console.log(`✓ Server "${name}" added to ${getConfigDir()}/config.json`);
}

async function removeMcpServerByName(name: string) {
  await removeMcpServer(getConfigDir(), name);
  console.log(`✓ Server "${name}" removed`);
}

async function startMcpServer(name: string) {
  const result = await connectMcpServer(name);
  if (result) {
    console.log(`✓ Server "${name}" started with ${result.toolCount} tools`);
  } else {
    console.error(`Error: Failed to start server "${name}"`);
    process.exit(1);
  }
}

async function stopMcpServer(name: string) {
  await disconnectMcpServer(name);
  console.log(`✓ Server "${name}" stopped`);
}

async function main() {
  // Print logo before yargs to avoid Unicode/formatting corruption
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('\n' + logo.trimEnd() + '\n');
  }

  const argv = await yargs(hideBin(process.argv))
    .scriptName('freecode')
    .usage('$0 [command] [options]')
    .version(version)
    .help()
    .command('mcp', 'Manage MCP servers', (yargs) =>
      yargs
        .command('list', 'List configured MCP servers', {}, async () => {
          await listMcpServers();
        })
        .command('add <name> <type> <command>', 'Add new MCP server', (yargs) => yargs, async (argv) => {
          await addMcpServer(String(argv.name), argv.type as 'local' | 'remote', String(argv.command));
        })
        .command('remove <name>', 'Remove MCP server', (yargs) => yargs, async (argv) => {
          await removeMcpServerByName(String(argv.name));
        })
        .command('start <name>', 'Start an MCP server', (yargs) => yargs, async (argv) => {
          try {
            await startMcpServer(String(argv.name));
          } catch (err) {
            console.error(`Error: ${(err as Error).message}`);
            process.exit(1);
          }
        })
        .command('stop <name>', 'Stop an MCP server', (yargs) => yargs, async (argv) => {
          try {
            await stopMcpServer(String(argv.name));
          } catch (err) {
            console.error(`Error: ${(err as Error).message}`);
            process.exit(1);
          }
        })
        .demandCommand(1, 'Specify a command')
    )
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