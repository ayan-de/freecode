// =============================================================================
// MCP Command — shows MCP server status from the daemon
// =============================================================================

import chalk from "chalk";
import {
  registerCommand,
  type Command,
  type CommandContext,
} from "../index.js";
import {
  startCli,
  mcpStatus,
  type McpServerStatus,
} from "../../ipc/client.js";

const mcpCommand: Command = {
  name: "mcp",
  description: "Show MCP server status",
  execute: async (args, ctx) => {
    // Ensure CLI is started
    startCli();

    try {
      const servers = await mcpStatus();

      if (servers.length === 0) {
        ctx.showMessage("**No MCP servers configured.**\n\n" +
          "Add a server: `freecode mcp add <name> local \"<command>\"`");
        return;
      }

      // Format the status
      let output = "**MCP Servers:**\n\n";

      for (const server of servers) {
        const statusColor = server.status === "connected"
          ? chalk.green
          : chalk.gray;
        const statusIcon = server.status === "connected" ? "●" : "○";

        output += `${chalk.cyan(server.name)} ${statusColor(statusIcon + " " + server.status)}\n`;
        output += `  Type: ${server.type}\n`;
        output += `  Tools: ${server.toolCount}`;

        if (server.status === "connected" && server.tools.length > 0) {
          const toolNames = server.tools.map((t: string) =>
            t.replace(`mcp__${server.name}__`, "")
          );
          output += ` (${toolNames.slice(0, 5).join(", ")}${toolNames.length > 5 ? "..." : ""})`;
        }
        output += "\n\n";
      }

      ctx.showMessage(output.trim());
    } catch (error) {
      ctx.showMessage(
        `Failed to get MCP status: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};

export function registerMcpCommand(): void {
  registerCommand(mcpCommand);
}
