// =============================================================================
// JSON-RPC Server — CLI Backend
// Handles tools.list, tools.call, session.start, session.send, session.stop, providers.list
// =============================================================================

import { getTool, listTools } from "./tools/index.js";
import { createAgentLoop } from "./agent/loop.js";
import { initProviders, listProviders } from "./providers/index.js";
import { logger } from "./utils/logger.js";
import type { ToolContext } from "./tools/types.js";
import type { JsonRpcRequest, JsonRpcResponse, SessionConfig } from "@freecode/shared";

interface ToolListItem {
  id: string;
  description: string;
}

interface ToolCallResult {
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
}

interface SessionStartResult {
  sessionId: string;
}

interface SessionInfo {
  id: string;
  projectPath: string;
  provider: string;
}

const sessions: Map<string, SessionInfo> = new Map();
let sessionCounter = 0;

function createSession(config: SessionConfig): SessionInfo {
  const id = `session-${++sessionCounter}`;
  const session: SessionInfo = {
    id,
    projectPath: config.projectPath,
    provider: config.provider || "anthropic",
  };
  sessions.set(id, session);
  return session;
}

function getSession(id: string): SessionInfo | undefined {
  return sessions.get(id);
}

function createResponse(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function createError(
  id: number | string,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

const methodHandlers: Record<
  string,
  (params: Record<string, unknown>) => Promise<unknown>
> = {
  "tools.list": async (): Promise<ToolListItem[]> => {
    return listTools();
  },

  "tools.call": async (params: Record<string, unknown>): Promise<ToolCallResult> => {
    const { name, args } = params as { name: string; args: Record<string, unknown> };
    const tool = getTool(name as string);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    const ctx: ToolContext = { cwd: process.cwd() };
    return tool.execute(args, ctx);
  },

  "session.start": async (params: Record<string, unknown>): Promise<SessionStartResult> => {
    const config = params as unknown as SessionConfig;
    const session = createSession(config);
    logger.info("Session started", { sessionId: session.id, provider: session.provider });
    return { sessionId: session.id };
  },

  "session.send": async (params: Record<string, unknown>): Promise<unknown> => {
    const { sessionId, message } = params as { sessionId: string; message: string };
    const session = getSession(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    logger.info("Session send", { sessionId, messageLength: message.length });

    const loop = createAgentLoop(sessionId, { maxIterations: 100 })
    const result = await loop.run({
      prompt: message,
      sessionId,
      provider: session.provider,
      projectPath: session.projectPath,
    })

    return result;
  },

  "session.stop": async (params: Record<string, unknown>): Promise<void> => {
    const { sessionId } = params as { sessionId: string };
    const session = getSession(sessionId);
    if (session) {
      sessions.delete(sessionId);
      logger.info("Session stopped", { sessionId });
    }
  },

  "providers.list": async (): Promise<unknown[]> => {
    return listProviders().map((p) => ({
      id: p.id,
      name: p.name,
      description: `AI provider via ${p.name}`,
    }));
  },
};

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  try {
    const handler = methodHandlers[request.method];
    if (!handler) {
      return createError(request.id, -32601, `Method not found: ${request.method}`);
    }
    const result = await handler(request.params ?? {});
    return createResponse(request.id, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createError(request.id, -32603, message);
  }
}

async function main() {
  await initProviders();

  let buffer = "";

  process.stdin.setEncoding("utf-8");

  process.stdin.on("data", async (chunk: string) => {
    buffer += chunk;

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as JsonRpcRequest;
        const response = await handleRequest(request);
        process.stdout.write(JSON.stringify(response) + "\n");
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        process.stderr.write(`Parse error: ${error}\n`);
      }
    }
  });

  process.stdin.on("end", () => {
    if (buffer.trim()) {
      try {
        const request = JSON.parse(buffer) as JsonRpcRequest;
        handleRequest(request).then((r) => {
          process.stdout.write(JSON.stringify(r) + "\n");
        });
      } catch (e) {
        process.stderr.write(`Final parse error: ${e}\n`);
      }
    }
  });
}

main().catch((e) => {
  process.stderr.write(`Server error: ${e}\n`);
  process.exit(1);
});