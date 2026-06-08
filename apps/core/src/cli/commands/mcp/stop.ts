import type { CommandModule } from 'yargs';

export const stopCommand: CommandModule = {
  command: 'stop <name>',
  describe: 'Stop an MCP server',
  builder: (yargs) =>
    yargs.positional('name', { type: 'string', demandOption: true }),
  handler: async (argv) => {
    const { disconnectMcpServer } = await import('../../../mcp/init.js');
    try {
      await disconnectMcpServer(argv.name as string);
      console.log(`✓ Server "${argv.name}" stopped`);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  },
};