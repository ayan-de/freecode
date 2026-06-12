import type { CommandModule } from "yargs";
import { listCommand } from "./list.js";
import { addCommand } from "./add.js";
import { removeCommand } from "./remove.js";
import { startCommand } from "./start.js";
import { stopCommand } from "./stop.js";

export const mcpCommand: CommandModule = {
  command: "mcp",
  describe: "Manage MCP servers",
  builder: (yargs) =>
    yargs
      .command(listCommand)
      .command(addCommand)
      .command(removeCommand)
      .command(startCommand)
      .command(stopCommand)
      .demandCommand(1, "Specify a subcommand"),
  handler: () => {
    // Default handler won't be reached due to demandCommand
  },
};
