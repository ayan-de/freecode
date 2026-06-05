// =============================================================================
// IPC Client — JSON-RPC bridge to CLI backend
// =============================================================================

import { spawn, type ChildProcess } from "child_process";
import { resolve as pathResolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ToolListItem,
  ToolResult,
  SessionConfig,
  ProviderInfo,
  StreamEvent,
} from "@thisisayande/freecode-shared";

// =============================================================================
// IPC Transport
// =============================================================================

let requestId = 0;
let cliProcess: ChildProcess | null = null;
let messageBuffer = "";
let pendingRequests = new Map<
  number | string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
let onStreamEvent: ((event: StreamEvent) => void) | null = null;

function generateId(): number {
  return ++requestId;
}

function parseResponse(data: string): JsonRpcResponse[] {
  const responses: JsonRpcResponse[] = [];
  const lines = data.split("\n");
  messageBuffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type && !parsed.jsonrpc && onStreamEvent) {
        onStreamEvent(parsed as StreamEvent);
        continue;
      }
      responses.push(parsed as JsonRpcResponse);
    } catch {
      // Skip malformed lines
    }
  }
  return responses;
}

export function startCli(onStderr?: (msg: string) => void): void {
  if (cliProcess) return;

  // Project root is the monorepo root (where pnpm-workspace.yaml lives)
  // When running `pnpm dev` from apps/tui, cwd is apps/tui, so go up two levels.
  let projectRoot = process.env.FREECODE_ROOT || process.cwd();
  const rootMarker = `${projectRoot}/pnpm-workspace.yaml`;
  if (!existsSync(rootMarker)) {
    projectRoot = pathResolve(projectRoot, "..", "..");
  }

  // Resolve path to CLI server relative to project root
  const cliPath = pathResolve(projectRoot, "apps/core/src/server.ts");

  cliProcess = spawn("npx", ["tsx", cliPath], {
    cwd: projectRoot,
    stdio: ["pipe", "pipe", "pipe"],
  });

  cliProcess.stdout?.setEncoding("utf-8");

  cliProcess.stderr?.on("data", (data) => {
    onStderr?.(data.toString().trim());
  });

  cliProcess.stdout?.on("data", (data: string) => {
    messageBuffer += data;
    const responses = parseResponse(messageBuffer);

    for (const response of responses) {
      const pending = pendingRequests.get(response.id);
      if (pending) {
        pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    }
  });

  cliProcess.on("error", (err) => {
    console.error("[CLI process error]", err);
    cliProcess = null;
  });

  cliProcess.on("exit", (code) => {
    console.log("[CLI exited]", code);
    cliProcess = null;
  });
}

function sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!cliProcess || !cliProcess.stdin) {
      reject(new Error("CLI not running"));
      return;
    }

    const id = generateId();
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });

    cliProcess.stdin.write(JSON.stringify(request) + "\n");
  });
}

export function stopCli(): void {
  if (cliProcess) {
    cliProcess.kill();
    cliProcess = null;
  }
}

// =============================================================================
// Tool Methods
// =============================================================================

export async function listTools(): Promise<ToolListItem[]> {
  return (await sendRequest("tools.list")) as ToolListItem[];
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await sendRequest("tools.call", { name, args })) as ToolResult;
}

// =============================================================================
// Session Methods
// =============================================================================

export interface SessionInfo {
  sessionId: string;
}

export async function sessionStart(config: SessionConfig): Promise<SessionInfo> {
  return (await sendRequest("session.start", config as unknown as Record<string, unknown>)) as SessionInfo;
}

export async function sessionStop(sessionId: string): Promise<void> {
  await sendRequest("session.stop", { sessionId });
}

export interface SessionSendResult {
  success: boolean;
  message?: string;
  content?: string;
  turnCount?: number;
  iterationCount?: number;
  usage?: { inputTokens: number; outputTokens: number };
}

export async function sessionSend(sessionId: string, message: string, model?: string): Promise<SessionSendResult> {
  return await sendRequest("session.send", { sessionId, message, model }) as SessionSendResult;
}

export async function sessionSendStreaming(
  sessionId: string,
  message: string,
  model: string | undefined,
  onEvent: (event: StreamEvent) => void
): Promise<SessionSendResult> {
  return new Promise((resolve, reject) => {
    if (!cliProcess || !cliProcess.stdin) {
      reject(new Error("CLI not running"));
      return;
    }

    onStreamEvent = onEvent;

    const id = generateId();
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method: "session.send", params: { sessionId, message, model } };
    pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });
    cliProcess.stdin.write(JSON.stringify(request) + "\n");
  });
}

// =============================================================================
// Provider Methods
// =============================================================================

export async function listProviders(): Promise<ProviderInfo[]> {
  return (await sendRequest("providers.list")) as ProviderInfo[];
}

export interface ModelInfo {
  id: string
  name: string
  description?: string
}

export async function listModels(providerId: string): Promise<ModelInfo[]> {
  return (await sendRequest("models.list", { providerId })) as ModelInfo[];
}

export interface ConfigInfo {
  providers?: Record<string, { apiKey?: string }>
  current?: { provider: string; model: string }
}

export async function getConfig(): Promise<ConfigInfo> {
  return (await sendRequest("config.get")) as ConfigInfo;
}

export async function setApiKey(provider: string, apiKey: string, model?: string): Promise<void> {
  await sendRequest("config.setApiKey", { provider, apiKey, model })
}

export async function setCurrentModel(provider: string, model: string): Promise<void> {
  await sendRequest("config.setCurrentModel", { provider, model })
}

export async function getCurrentModel(): Promise<{ provider: string; model: string } | undefined> {
  return (await sendRequest("config.getCurrentModel")) as { provider: string; model: string } | undefined
}

// =============================================================================
// Session List/Resume Methods
// =============================================================================

export interface SessionMeta {
  id: string
  title: string
  projectPath: string
  provider: string
  model?: string
  status: 'active' | 'interrupted' | 'archived' | 'deleted'
  createdAt: number
  updatedAt: number
  lastTurnAt: number
  turnCount: number
  parentId?: string
  aggregatedTokenCount?: number
}

export interface SessionFilter {
  status?: 'active' | 'interrupted' | 'archived' | 'deleted'
  projectPath?: string
}

export async function sessionList(filter?: SessionFilter): Promise<SessionMeta[]> {
  return (await sendRequest("session.list", filter as Record<string, unknown>)) as SessionMeta[]
}

export async function sessionResume(sessionId: string): Promise<{ sessionId: string; messages?: SerializedMessage[] }> {
  return (await sendRequest("session.resume", { sessionId })) as { sessionId: string; messages?: SerializedMessage[] }
}

export interface SerializedMessage {
  id: string
  role: 'user' | 'assistant'
  parts: Array<{
    type: 'text' | 'code' | 'tool'
    content?: string
    language?: string
    tool?: { name: string; args: Record<string, unknown> }
    result?: string
  }>
  timestamp: number
  interrupted?: boolean
}
