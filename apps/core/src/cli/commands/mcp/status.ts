import type { CommandModule } from "yargs";
import { loadMcpConfig } from "../../../mcp/config.js";
import { getConfigDir } from "../../utils/config.js";

interface StatusArgs {
  name: string;
}

export const statusCommand: CommandModule<object, StatusArgs> = {
  command: "status <name>",
  describe: "Show status of an MCP server",
  builder: (yargs) =>
    yargs.positional("name", { type: "string", demandOption: true }),
  handler: async (argv) => {
    const config = await loadMcpConfig(getConfigDir());
    const server = config.servers.find((s) => s.name === argv.name);

    if (!server) {
      console.error(`Error: MCP server "${argv.name}" not found in config`);
      process.exit(1);
    }

    console.log(`\nMCP Server: ${argv.name}`);
    console.log("─".repeat(40));
    console.log(`Type:      ${server.type}`);
    console.log(`Enabled:   ${server.enabled ? "yes" : "no"}`);
    console.log(`Timeout:   ${server.timeout ?? 5000}ms`);

    if (server.type === "local" && server.command) {
      console.log(`\nCommand:   ${server.command.join(" ")}`);
      if (server.args && server.args.length > 0) {
        console.log(`Args:      ${server.args.join(" ")}`);
      }
      if (server.env) {
        console.log(`Env:`);
        for (const [key, value] of Object.entries(server.env)) {
          console.log(`  ${key}=${value}`);
        }
      }
    } else if (server.type === "remote" && server.url) {
      console.log(`\nURL:       ${server.url}`);
      if (server.headers) {
        console.log(`Headers:`);
        for (const [key, value] of Object.entries(server.headers)) {
          console.log(`  ${key}: ***`);
        }
      }
    }

    console.log("\n" + "─".repeat(40));
    console.log("Note: Connect to see live status — run 'freecode serve' (TUI/VSCode)");
    console.log("");
  },
};
