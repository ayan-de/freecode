#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as os from 'os';
import * as path from 'path';
import { loadMcpConfig, saveMcpServer, removeMcpServer } from './mcp/config.js';
import type { McpServer } from './mcp/types.js';

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

async function main() {
  const argv = await yargs(hideBin(process.argv))
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
        .demandCommand(1, 'Specify a command')
    )
    .demandCommand(1, 'Specify a command')
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