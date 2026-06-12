import type { CommandModule } from "yargs";
import type { McpServer } from "../../../mcp/types.js";
import { saveMcpServer } from "../../../mcp/config.js";
import { getConfigDir } from "../../utils/config.js";

export const addCommand: CommandModule = {
  command: "add <name> <type> <command>",
  describe: "Add new MCP server",
  builder: (yargs) => yargs,
  handler: async (argv) => {
    const type = argv.type as "local" | "remote";
    const server: McpServer = {
      name: String(argv.name),
      type,
      command: String(argv.command).split(" "),
      enabled: true,
      timeout: 5000,
    };
    await saveMcpServer(getConfigDir(), server);
    console.log(
      `✓ Server "${server.name}" added to ${getConfigDir()}/config.json`,
    );
  },
};
