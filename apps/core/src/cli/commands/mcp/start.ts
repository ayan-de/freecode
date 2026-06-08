import type { CommandModule } from 'yargs';

export const startCommand: CommandModule = {
  command: 'start <name>',
  describe: 'Start an MCP server',
  builder: (yargs) =>
    yargs.positional('name', { type: 'string', demandOption: true }),
  handler: async (argv) => {
    const { connectMcpServer } = await import('../../../mcp/init.js');
    try {
      const result = await connectMcpServer(argv.name as string);
      if (result) {
        console.log(`✓ Server "${argv.name}" started with ${result.toolCount} tools`);
      } else {
        console.error(`Error: Failed to start server "${argv.name}"`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  },
};