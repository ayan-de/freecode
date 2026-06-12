import * as os from "os";
import * as path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { loadMcpConfig } from "./config.js";
import { createStdioTransport } from "./transport.js";
import {
  registerClient,
  removeClient,
  getClient,
  listClients,
} from "./client-registry.js";
import { convertMcpTool } from "./convert-tool.js";
import { registerMcpTool, unregisterMcpTools } from "../tools/index.js";
import { BusEvents } from "../bus/index.js";
import type { McpServer } from "./types.js";

function getConfigDir(): string {
  return path.join(os.homedir(), ".freecode");
}

async function connectServer(
  server: McpServer,
): Promise<{ name: string; toolCount: number } | null> {
  try {
    const transport = createStdioTransport({
      command: server.command?.[0] || "",
      args: server.command?.slice(1) || [],
      env: server.env as Record<string, string> | undefined,
    });

    const mcpClient = new Client(
      {
        name: server.name,
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    );

    await mcpClient.connect(transport);

    // Register the client so tools can use it
    registerClient(server.name, mcpClient);

    // List tools and register them
    const toolsResponse = await mcpClient.listTools();
    const tools = toolsResponse.tools || [];

    for (const tool of tools) {
      const converted = convertMcpTool(tool, server.name);
      registerMcpTool(converted);
    }

    BusEvents.mcpServerStarted(server.name, tools.length);

    return { name: server.name, toolCount: tools.length };
  } catch (err) {
    BusEvents.mcpServerError(server.name, String(err));
    return null;
  }
}

export async function initMcpServers(): Promise<void> {
  const configDir = getConfigDir();
  const config = await loadMcpConfig(configDir);

  const enabledServers = config.servers.filter((s) => s.enabled !== false);

  // Connect to all enabled servers in parallel
  const results = await Promise.allSettled(
    enabledServers.map((server) => connectServer(server)),
  );

  const connected = results.filter(
    (r) => r.status === "fulfilled" && r.value !== null,
  ).length;
  console.error(
    `[MCP] Initialized ${connected}/${enabledServers.length} servers`,
  );

  // Emit tools changed for all servers that connected successfully
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      BusEvents.mcpToolsChanged(result.value.name);
    }
  }
}

export async function stopMcpServers(): Promise<void> {
  const names = listClients();

  for (const name of names) {
    try {
      const client = getClient(name);
      if (client) {
        await client.close();
        removeClient(name);
        BusEvents.mcpServerStopped(name, "shutdown");
      }
    } catch (err) {
      // Ignore errors during shutdown
    }
  }

  // Unregister all MCP tools
  for (const name of names) {
    unregisterMcpTools(`${name}_`);
  }
}

// Connect a single MCP server by name
export async function connectMcpServer(
  name: string,
): Promise<{ name: string; toolCount: number } | null> {
  const configDir = getConfigDir();
  const config = await loadMcpConfig(configDir);

  const server = config.servers.find((s) => s.name === name);
  if (!server) {
    throw new Error(`MCP server "${name}" not found in config`);
  }

  if (server.type !== "local") {
    throw new Error("Remote MCP servers not yet supported");
  }

  // Check if already connected
  if (getClient(name)) {
    throw new Error(`MCP server "${name}" is already connected`);
  }

  const result = await connectServer(server);
  if (result) {
    BusEvents.mcpToolsChanged(name);
  }
  return result;
}

// Disconnect a single MCP server by name
export async function disconnectMcpServer(name: string): Promise<void> {
  const client = getClient(name);
  if (!client) {
    throw new Error(`MCP server "${name}" is not connected`);
  }

  await client.close();
  removeClient(name);
  unregisterMcpTools(`${name}_`);
  BusEvents.mcpServerStopped(name, "manual");
}
