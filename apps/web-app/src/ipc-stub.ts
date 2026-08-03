// =============================================================================
// HTTP + SSE IPC Bridge — communicates with the CLI backend server
// =============================================================================

export interface ToolListItem {
  id: string;
  description?: string;
}

export interface ToolCallResult {
  success: boolean;
  output?: string;
  error?: string;
}

export interface SessionInfo {
  sessionId: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  hasApiKey: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  openStreamReader,
  discoverToken,
  type SSEController,
  type SSEEvent,
} from "./lib/sse-reader.js";

// Helper to check if we are running inside the Tauri desktop app
const isTauri =
  typeof window !== "undefined" &&
  (window as any).__TAURI_INTERNALS__ !== undefined;

const HTTP_BASE_URL = "http://127.0.0.1:4096";

let nextRequestId = 1;
const pendingRequests = new Map<
  number,
  { resolve: (val: any) => void; reject: (err: any) => void }
>();
let streamCallback: ((event: any) => void) | null = null;
let unlistenCliMessage: UnlistenFn | null = null;

// Initialize Tauri listener for all CLI output
async function initTauriListener() {
  if (unlistenCliMessage || !isTauri) return;
  unlistenCliMessage = await listen<string>("cli-message", (event) => {
    try {
      const data = JSON.parse(event.payload);
      // If it has an id, it's a JSON-RPC response
      if (data.id !== undefined && pendingRequests.has(data.id)) {
        const promiseHandlers = pendingRequests.get(data.id)!;
        pendingRequests.delete(data.id);
        if (data.error) {
          promiseHandlers.reject(
            new Error(data.error.message || "Request failed"),
          );
        } else {
          promiseHandlers.resolve(data.result);
        }
      }
      // Otherwise, if there is a stream callback and it looks like a stream event (has type)
      else if (streamCallback && data.type) {
        streamCallback(data);
      }
    } catch (err) {
      console.error("[IPC] Failed to parse cli-message:", err, event.payload);
    }
  });
}

// Connect to the backend (verifies backend is reachable via Tauri)
export async function connectBackend(): Promise<void> {
  if (isTauri) {
    await initTauriListener();
  }
  // Ping backend to ensure CLI is up
  await sendRequest("providers.list");
}

// Send a JSON-RPC request over Tauri's CLI stdin pipe OR Http
async function sendRequest<T>(
  method: string,
  params: Record<string, any> = {},
): Promise<T> {
  const id = nextRequestId++;
  const request = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };

  if (isTauri) {
    await initTauriListener();
    return new Promise<T>((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      invoke("send_to_cli", { message: JSON.stringify(request) }).catch(reject);
    });
  } else {
    // Fallback to HTTP for normal web browsers. Carry the bearer token
    // so a non-loopback bind (spec §4.1) doesn't 401 every call.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const token = discoverToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${HTTP_BASE_URL}/api`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const data = await response.json();

    if (data.error) {
      // Server-side error. Surface the JSON-RPC error shape — call sites
      // can inspect data.error.code to render -32002 (already-resolved)
      // as state, not failure (spec §4.4).
      const err = new Error(data.error.message || "Request failed") as Error & {
        code?: number;
        data?: unknown;
      };
      err.code = data.error.code;
      err.data = data.error.data;
      throw err;
    }
    return data.result as T;
  }
}

let streamController: SSEController | null = null;

export function registerStreamListener(
  sessionId: string,
  callback: (event: any) => void,
): void {
  streamCallback = callback;

  if (!isTauri) {
    // Tear down any previous reader before starting a new one. The new
    // reader will reconnect with the last id: it observed, so the
    // switch is gap-free.
    if (streamController) streamController.close();
    const token = discoverToken();
    streamController = openStreamReader(
      sessionId,
      token,
      (event: SSEEvent) => {
        // Each event is `{ data: <json>, id?, event? }`. The data field
        // is the wire payload — JSON.parsed by the server already (the
        // server serializes once). We surface it to the callback as
        // before so the rest of the SPA keeps the existing shape.
        if (event.data === undefined || event.data === null) return;
        if (typeof event.data !== "string") {
          // The server always sends JSON; non-string data is unexpected.
          console.warn("Unexpected SSE data shape", event.data);
          return;
        }
        try {
          // The data is a JSON string. The server serializes the wire
          // event once into the data: field, so we parse here.
          const payload = JSON.parse(event.data);
          if (streamCallback && payload.type) {
            streamCallback(payload);
          }
        } catch (err) {
          console.error("Failed to parse SSE message", err);
        }
      },
      {
        // Spec §4.2: stay alive through a network blip. The exponential
        // backoff caps at 30s so we don't hammer while the phone is in
        // a tunnel.
        initialReconnectMs: 500,
        maxReconnectMs: 30_000,
      },
    );
  }
}

export function unregisterStreamListener(): void {
  streamCallback = null;
  if (streamController) {
    streamController.close();
    streamController = null;
  }
}

export async function listTools(): Promise<ToolListItem[]> {
  return sendRequest<ToolListItem[]>("tools.list");
}

export async function sessionStart(config: {
  projectPath: string;
  provider?: string;
  model?: string;
  agentMode?: string;
}): Promise<SessionInfo> {
  return sendRequest<SessionInfo>("session.start", config);
}

export async function sessionSend(
  sessionId: string,
  message: string,
  model?: string,
  agentMode?: string,
): Promise<unknown> {
  return sendRequest("session.send", { sessionId, message, model, agentMode });
}

export async function listProviders(): Promise<ProviderInfo[]> {
  return sendRequest<ProviderInfo[]>("providers.list");
}

export async function listModels(providerId: string): Promise<ModelInfo[]> {
  const models = await sendRequest<any[]>("models.list", { providerId });
  return models.map((m) => ({
    id: m.id,
    name: m.name,
    provider: providerId,
  }));
}

export async function getCurrentModel(): Promise<
  { provider: string; model: string } | undefined
> {
  return sendRequest<{ provider: string; model: string } | undefined>(
    "config.getCurrentModel",
  );
}

export async function setCurrentModel(
  provider: string,
  model: string,
): Promise<void> {
  return sendRequest<void>("config.setCurrentModel", { provider, model });
}

export async function getApiKeyStatus(): Promise<Record<string, boolean>> {
  const config = await sendRequest<any>("config.get");
  const providers = config?.providers || {};
  const status: Record<string, boolean> = {};
  for (const [p, conf] of Object.entries(providers)) {
    status[p] = !!(conf as any).apiKey;
  }
  return status;
}

export async function setApiKey(
  provider: string,
  apiKey: string,
  model?: string,
): Promise<void> {
  return sendRequest<void>("config.setApiKey", { provider, apiKey, model });
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  return sendRequest<ToolCallResult>("tools.call", { name, args });
}

export async function stopSession(sessionId: string): Promise<void> {
  return sendRequest<void>("session.stop", { sessionId });
}

// =============================================================================
// Approval flow (spec §4.4) — answer / reject the prompts the agent emits.
//
// These RPCs return void on success but THROW a -32002 error when the
// request had already been resolved by another device or the timeout
// (REQUEST_ALREADY_RESOLVED). Callers should render that as a normal
// outcome ("Already answered on another device"), not as a failure.
// =============================================================================

/** Answer a question prompt (multi-choice). */
export async function answerQuestion(
  requestId: string,
  answers: string[],
): Promise<void> {
  return sendRequest<void>("question.answer", { requestId, answers });
}

/** Reject (dismiss) a question prompt without answering. */
export async function rejectQuestion(requestId: string): Promise<void> {
  return sendRequest<void>("question.reject", { requestId });
}

export type PermissionDecision =
  | "allow-once"
  | "allow-session"
  | "allow-project"
  | "allow-always"
  | "deny";

/** Answer a permission prompt — allow (with optional scope) or deny. */
export async function answerPermission(
  requestId: string,
  decision: PermissionDecision,
  editedRule?: string,
): Promise<void> {
  return sendRequest<void>("permission.answer", {
    requestId,
    decision,
    editedRule,
  });
}

/** Reject (dismiss) a permission prompt. Treated as deny by askPermission. */
export async function rejectPermission(requestId: string): Promise<void> {
  return sendRequest<void>("permission.reject", { requestId });
}

export interface SessionContext {
  id: string;
  title?: string;
  projectPath: string;
  provider: string;
  model?: string;
  status: "active" | "interrupted" | "archived" | "deleted";
  turnCount: number;
  lastTurnAt: number;
}

export async function listSessions(
  projectPath: string,
): Promise<SessionContext[]> {
  return sendRequest<SessionContext[]>("session.list", { projectPath });
}

export async function resumeSession(
  sessionId: string,
): Promise<{ sessionId: string; messages: any[] }> {
  return sendRequest<{ sessionId: string; messages: any[] }>("session.resume", {
    sessionId,
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  return sendRequest<void>("session.delete", { sessionId });
}

// =============================================================================
// MCP Methods
// =============================================================================

export interface McpServerStatus {
  name: string;
  type: string;
  enabled: boolean;
  status: "connected" | "disconnected";
  toolCount: number;
  tools: string[];
}

export async function mcpStatus(
  name?: string,
): Promise<McpServerStatus[]> {
  return sendRequest<McpServerStatus[]>(
    "mcp.status",
    name ? { name } : {},
  );
}
