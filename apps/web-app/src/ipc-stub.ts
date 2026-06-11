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

let nextRequestId = 1;
let eventSource: EventSource | null = null;

// Connect to the backend (verifies backend is reachable)
export async function connectBackend(): Promise<void> {
  const response = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ping",
      method: "providers.list",
    }),
  });
  if (!response.ok) {
    throw new Error("Backend server is not responding");
  }
}

// Send a JSON-RPC request over HTTP POST
async function sendRequest<T>(method: string, params: Record<string, any> = {}): Promise<T> {
  const id = nextRequestId++;
  const request = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };

  const response = await fetch("/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || "Request failed");
  }
  return data.result as T;
}

export function registerStreamListener(sessionId: string, callback: (event: any) => void): void {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`/events?sessionId=${sessionId}`);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      callback(data);
    } catch (err) {
      console.error("[IPC] Failed to parse SSE event data:", err);
    }
  };

  eventSource.onerror = (err) => {
    console.error("[IPC] EventSource error:", err);
  };
}

export function unregisterStreamListener(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
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
  agentMode?: string
): Promise<unknown> {
  return sendRequest("session.send", { sessionId, message, model, agentMode });
}

export async function listProviders(): Promise<ProviderInfo[]> {
  return sendRequest<ProviderInfo[]>("providers.list");
}

export async function listModels(providerId: string): Promise<ModelInfo[]> {
  return sendRequest<ModelInfo[]>("models.list", { providerId });
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

export async function setApiKey(provider: string, apiKey: string, model?: string): Promise<void> {
  return sendRequest<void>("config.setApiKey", { provider, apiKey, model });
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  return sendRequest<ToolCallResult>("tools.call", { name, args });
}

export async function stopSession(sessionId: string): Promise<void> {
  return sendRequest<void>("session.stop", { sessionId });
}

export interface SessionContext {
  id: string;
  title?: string;
  projectPath: string;
  provider: string;
  model?: string;
  status: "active" | "archived" | "deleted";
  turnCount: number;
  lastTurnAt: number;
}

export async function listSessions(projectPath: string): Promise<SessionContext[]> {
  return sendRequest<SessionContext[]>("session.list", { projectPath });
}

export async function resumeSession(sessionId: string): Promise<{ sessionId: string; messages: any[] }> {
  return sendRequest<{ sessionId: string; messages: any[] }>("session.resume", { sessionId });
}

export async function deleteSession(sessionId: string): Promise<void> {
  return sendRequest<void>("session.delete", { sessionId });
}

