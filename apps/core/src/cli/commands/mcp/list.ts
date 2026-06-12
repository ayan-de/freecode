import type { CommandModule } from "yargs";
import { loadMcpConfig } from "../../../mcp/config.js";
import { getConfigDir } from "../../utils/config.js";

const handler = async () => {
  const config = await loadMcpConfig(getConfigDir());
  console.log("\nMCP Servers:");
  console.log("┌────────────────┬─────────┬──────────────┐");
  console.log("│ Name           │ Type    │ Enabled      │");
  console.log("├────────────────┼─────────┼──────────────┤");

  if (config.servers.length === 0) {
    console.log("│ (no servers configured)                    │");
  }

  for (const server of config.servers) {
    const name = server.name.padEnd(14);
    const type = server.type.padEnd(7);
    const enabled = server.enabled ? "yes" : "no";
    console.log(`│ ${name} │ ${type} │ ${enabled.padEnd(12)} │`);
  }
  console.log("└────────────────┴─────────┴──────────────┘\n");
};

export const listCommand: CommandModule = {
  command: "list",
  describe: "List configured MCP servers",
  handler,
};
