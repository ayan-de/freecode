import type { CommandModule } from "yargs";
import { removeMcpServer } from "../../../mcp/config.js";
import { getConfigDir } from "../../utils/config.js";

interface RemoveArgs {
  name: string;
}

export const removeCommand: CommandModule<object, RemoveArgs> = {
  command: "remove <name>",
  describe: "Remove MCP server",
  builder: (yargs) =>
    yargs.positional("name", { type: "string", demandOption: true }),
  handler: async (argv) => {
    await removeMcpServer(getConfigDir(), argv.name);
    console.log(`✓ Server "${argv.name}" removed`);
  },
};
