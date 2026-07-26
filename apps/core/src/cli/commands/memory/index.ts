import type { CommandModule } from "yargs";
import { graphCommand } from "./graph.js";

export const memoryCommand: CommandModule = {
  command: "memory",
  describe: "Manage persistent memory",
  builder: (yargs) =>
    yargs.command(graphCommand).demandCommand(1, "Specify a subcommand"),
  handler: () => {},
};
