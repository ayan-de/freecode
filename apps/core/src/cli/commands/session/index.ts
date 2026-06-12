import type { CommandModule } from "yargs";
import { listCommand } from "./list.js";
import { deleteCommand } from "./delete.js";

export const sessionCommand: CommandModule = {
  command: "session",
  describe: "Manage sessions",
  builder: (yargs) =>
    yargs
      .command(listCommand)
      .command(deleteCommand)
      .demandCommand(1, "Specify a subcommand"),
  handler: () => {
    // Default handler won't be reached due to demandCommand
  },
};
