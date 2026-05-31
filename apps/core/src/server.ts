// =============================================================================
// JSON-RPC Server — CLI Backend
// Handles tools.list, tools.call, session.start, session.send, session.stop, providers.list
// =============================================================================

import { getTool, listTools } from "./tools/index.js";
import { createAgentLoop } from "./agent/loop.js";
import { initProviders, listProviders } from "./providers/index.js";
import { getProviders, getProviderModels } from "./models-dev.js";
import { readConfig, writeConfig, setApiKey, setCurrentModel, hasApiKey, getCurrentModel, type ProviderId } from "./providers/config.js";
import { logger } from "./utils/logger.js";
import type { ToolContext } from "./tools/types.js";
import type { JsonRpcRequest, JsonRpcResponse, SessionConfig } from "@freecode/shared";
import { getMemoryStore, type MemoryEntry, type MemoryType } from "./memory/index.js";
import { findRelevantMemories } from "./memory/mem-query.js";
import { buildMemoryPrompt } from "./memory/mem-prompt.js";
import { getSessionManager, type SessionContext } from "./session/index.js";
import { getRemoteSync, type ExportedSession, type RemoteSessionConfig } from "./store/index.js";

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
  model?: string;
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
    const result = await tool.execute(args, ctx);
    if (!result.success) {
      throw new Error(result.error);
    }
    return result.result as ToolCallResult;
  },

  "session.start": async (params: Record<string, unknown>): Promise<SessionStartResult> => {
    const config = params as unknown as SessionConfig;
    const session = createSession(config);
    logger.info("Session started", { sessionId: session.id, provider: session.provider });
    return { sessionId: session.id };
  },

  "session.send": async (params: Record<string, unknown>): Promise<unknown> => {
    const { sessionId, message, model } = params as { sessionId: string; message: string; model?: string };
    const session = getSession(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Get current provider from config, fallback to session.provider
    const config = readConfig()
    const currentProvider = config.current?.provider || session.provider

    // Update session with model if provided
    if (model) {
      session.model = model;
    }

    logger.info("Session send", { sessionId, messageLength: message.length, model: session.model, provider: currentProvider });

    const loop = createAgentLoop(sessionId, { maxIterations: 100 })
    const result = await loop.run({
      prompt: message,
      sessionId,
      provider: currentProvider,
      model: session.model,
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
    const providers = await getProviders()
    return providers.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      hasApiKey: hasApiKey(p.id as ProviderId),
    }))
  },

  "models.list": async (params: Record<string, unknown>): Promise<unknown[]> => {
    const { providerId } = params as { providerId: string }
    const models = await getProviderModels(providerId)
    return models
  },

  "config.get": async (): Promise<unknown> => {
    return readConfig()
  },

  "config.setApiKey": async (params: Record<string, unknown>): Promise<void> => {
    const { provider, apiKey, model } = params as { provider: string; apiKey: string; model?: string }
    setApiKey(provider as ProviderId, apiKey, model)
  },

  "config.setCurrentModel": async (params: Record<string, unknown>): Promise<void> => {
    const { provider, model } = params as { provider: string; model: string }
    setCurrentModel(provider, model)
  },

  "config.getCurrentModel": async (): Promise<unknown> => {
    return getCurrentModel()
  },

  // ========== Memory Methods ==========

  "memory.list": async (params: Record<string, unknown>): Promise<MemoryEntry[]> => {
    const { projectPath, type } = params as { projectPath?: string; type?: MemoryType }
    const store = getMemoryStore(projectPath || process.cwd())
    return store.list(type)
  },

  "memory.get": async (params: Record<string, unknown>): Promise<MemoryEntry | null> => {
    const { name, type, projectPath } = params as { name: string; type: MemoryType; projectPath?: string }
    const store = getMemoryStore(projectPath || process.cwd())
    return store.load(name, type) || null
  },

  "memory.save": async (params: Record<string, unknown>): Promise<void> => {
    const { entry, projectPath } = params as { entry: MemoryEntry; projectPath?: string }
    const store = getMemoryStore(projectPath || process.cwd())
    store.save(entry)
  },

  "memory.delete": async (params: Record<string, unknown>): Promise<boolean> => {
    const { name, type, projectPath } = params as { name: string; type: MemoryType; projectPath?: string }
    const store = getMemoryStore(projectPath || process.cwd())
    return store.delete(name, type)
  },

  "memory.query": async (params: Record<string, unknown>): Promise<MemoryEntry[]> => {
    const { query, projectPath, limit, types } = params as { query: string; projectPath?: string; limit?: number; types?: MemoryType[] }
    const store = getMemoryStore(projectPath || process.cwd())
    return findRelevantMemories(query, store, { limit, types })
  },

  "memory.buildPrompt": async (params: Record<string, unknown>): Promise<string> => {
    const { projectPath, includeAll, types, limit } = params as { projectPath?: string; includeAll?: boolean; types?: MemoryType[]; limit?: number }
    const store = getMemoryStore(projectPath || process.cwd())
    return buildMemoryPrompt(store, { includeAll, types, limit })
  },

  // ========== Session Methods ==========

  "session.list": async (params: Record<string, unknown>): Promise<SessionContext[]> => {
    const { projectPath, status } = params as { projectPath?: string; status?: "active" | "archived" | "deleted" }
    const manager = await getSessionManager()
    return manager.list({ projectPath, status })
  },

  "session.resume": async (params: Record<string, unknown>): Promise<SessionContext> => {
    const { sessionId } = params as { sessionId: string }
    const manager = await getSessionManager()
    return manager.resume(sessionId)
  },

  "session.switch": async (params: Record<string, unknown>): Promise<void> => {
    const { sessionId } = params as { sessionId: string }
    const manager = await getSessionManager()
    await manager.switch(sessionId)
  },

  "session.fork": async (params: Record<string, unknown>): Promise<string> => {
    const { sessionId, point } = params as { sessionId: string; point?: string }
    const manager = await getSessionManager()
    return manager.fork(sessionId, point)
  },

  "session.archive": async (params: Record<string, unknown>): Promise<void> => {
    const { sessionId } = params as { sessionId: string }
    const manager = await getSessionManager()
    await manager.archive(sessionId)
  },

  "session.delete": async (params: Record<string, unknown>): Promise<void> => {
    const { sessionId } = params as { sessionId: string }
    const manager = await getSessionManager()
    await manager.delete(sessionId)
  },

  // ========== Remote Sync Methods ==========

  "session.export": async (params: Record<string, unknown>): Promise<ExportedSession> => {
    const { sessionId } = params as { sessionId: string }
    const remoteSync = await getRemoteSync()
    return remoteSync.exportSession(sessionId)
  },

  "session.upload": async (params: Record<string, unknown>): Promise<string> => {
    const { sessionId, endpoint, apiKey } = params as { sessionId: string; endpoint: string; apiKey?: string }
    const remoteSync = await getRemoteSync()
    return remoteSync.upload(sessionId, { endpoint, apiKey })
  },

  "session.download": async (params: Record<string, unknown>): Promise<string> => {
    const { url, endpoint, apiKey } = params as { url: string; endpoint?: string; apiKey?: string }
    const remoteSync = await getRemoteSync()
    return remoteSync.download(url, { endpoint: endpoint || url, apiKey })
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