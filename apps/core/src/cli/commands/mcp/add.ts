import type { CommandModule } from "yargs";
import type { McpServer } from "../../../mcp/types.js";
import { saveMcpServer } from "../../../mcp/config.js";
import { getConfigDir } from "../../utils/config.js";

export const addCommand: CommandModule = {
  command: "add <name> <type> <command>",
  describe: "Add new MCP server",
  builder: (yargs) =>
    yargs
      .positional("name", { type: "string", demandOption: true })
      .positional("type", {
        type: "string",
        demandOption: true,
        choices: ["local", "remote"],
      })
      .positional("command", {
        type: "string",
        demandOption: true,
        description:
          "For local: command to run (e.g., 'npx'). For remote: URL endpoint",
      }),
  handler: async (argv: any) => {
    const type = argv.type as "local" | "remote";
    const name = String(argv.name);
    const commandOrUrl = String(argv.command);

    const server: McpServer = {
      name,
      type,
      enabled: true,
      timeout: 5000,
    };

    if (type === "local") {
      server.command = commandOrUrl.split(" ");
    } else if (type === "remote") {
      server.url = commandOrUrl;
    }

    await saveMcpServer(getConfigDir(), server);
    console.log(
      `✓ Server "${server.name}" added to ${getConfigDir()}/config.json`,
    );
  },
};
