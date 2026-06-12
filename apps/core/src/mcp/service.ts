import { Context, Effect, Layer } from "effect";
import * as os from "os";
import * as path from "path";
import { loadMcpConfig } from "./config.js";
import { createStdioTransport } from "./transport.js";
import type { McpServer, McpClient } from "./types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export interface MCPService {
  readonly status: () => Effect.Effect<
    Map<string, { status: string; toolCount: number }>
  >;
  readonly connect: (name: string) => Effect.Effect<void>;
  readonly disconnect: (name: string) => Effect.Effect<void>;
}

export const MCPService = Context.GenericTag<MCPService>("MCPService");

function getConfigDir(): string {
  return path.join(os.homedir(), ".freecode");
}

export const MCPLive = Layer.effect(
  MCPService,
  Effect.gen(function* () {
    const clients = new Map<string, McpClient>();
    let config = yield* Effect.promise(() => loadMcpConfig(getConfigDir()));

    const status = () =>
      Effect.succeed(
        new Map(
          config.servers.map((s) => [
            s.name,
            {
              status: clients.get(s.name)?.status || "disconnected",
              toolCount: clients.get(s.name)?.tools.size || 0,
            },
          ]),
        ),
      );

    const connect = (name: string) =>
      Effect.gen(function* () {
        const server = config.servers.find((s) => s.name === name);
        if (!server) {
          yield* Effect.fail(new Error(`MCP server not found: ${name}`));
          return;
        }

        if (server.type !== "local") {
          yield* Effect.fail(new Error("Remote MCP servers not yet supported"));
          return;
        }

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

        yield* Effect.promise(() => mcpClient.connect(transport));

        const client: McpClient = {
          name: server.name,
          status: "connected",
          tools: new Map(),
          start: async () => {},
          stop: async () => {
            await mcpClient.close();
          },
        };

        clients.set(name, client);
      });

    const disconnect = (name: string) =>
      Effect.gen(function* () {
        const client = clients.get(name);
        if (client) {
          yield* Effect.promise(() => client.stop());
          clients.delete(name);
        }
      });

    return { status, connect, disconnect } as MCPService;
  }),
);
