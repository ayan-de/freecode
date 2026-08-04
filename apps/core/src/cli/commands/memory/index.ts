import type { CommandModule } from "yargs";
import { graphCommand } from "./graph.js";
import { uiInstallCommand, uiUninstallCommand } from "./ui.js";

export const memoryCommand: CommandModule = {
  command: "memory",
  describe: "Manage persistent memory",
  builder: (yargs) =>
    yargs
      .command(graphCommand)
      .command(uiInstallCommand)
      .command(uiUninstallCommand)
      .demandCommand(1, "Specify a subcommand"),
  handler: () => {},
};
