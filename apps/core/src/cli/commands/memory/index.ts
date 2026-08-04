import type { CommandModule } from "yargs";
import { graphCommand } from "./graph.js";
import { uiCommand } from "./ui.js";

export const memoryCommand: CommandModule = {
  command: "memory",
  describe: "Manage persistent memory",
  builder: (yargs) =>
    yargs
      .command(graphCommand)
      .command(uiCommand)
      .demandCommand(1, "Specify a subcommand"),
  handler: () => {},
};
