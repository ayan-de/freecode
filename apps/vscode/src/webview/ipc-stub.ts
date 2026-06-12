// IPC bridge — communicates with extension host via postMessage
// The actual CLI IPC lives in extension host, webview sends messages to it

export interface ToolListItem {
  name: string;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function acquireVsCodeApi(): any;
const vscode =
  typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : null;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMsg: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMsg)), timeoutMs);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function startCli(): void {
  vscode?.postMessage({ type: "startCli" });
}

export async function listTools(): Promise<ToolListItem[]> {
  const promise = new Promise<ToolListItem[]>((resolve, reject) => {
    const listener = (event: MessageEvent) => {
      if (event.data.type === "toolsList") {
        window.removeEventListener("message", listener);
        resolve(event.data.tools as ToolListItem[]);
      } else if (event.data.type === "error") {
        window.removeEventListener("message", listener);
        reject(new Error(event.data.error));
      }
    };
    window.addEventListener("message", listener);
    vscode?.postMessage({ type: "listTools" });
  });
  return withTimeout(promise, 10000, "listTools timed out");
}

export async function sessionStart(config: {
  projectPath: string;
  provider?: string;
}): Promise<SessionInfo> {
  const promise = new Promise<SessionInfo>((resolve, reject) => {
    const listener = (event: MessageEvent) => {
      if (event.data.type === "sessionStarted") {
        window.removeEventListener("message", listener);
        resolve(event.data.session as SessionInfo);
      } else if (event.data.type === "error") {
        window.removeEventListener("message", listener);
        reject(new Error(event.data.error));
      }
    };
    window.addEventListener("message", listener);
    vscode?.postMessage({ type: "sessionStart", config });
  });
  return withTimeout(
    promise,
    15000,
    "sessionStart timed out — CLI may not have started",
  );
}

export async function sessionSend(
  sessionId: string,
  message: string,
): Promise<unknown> {
  const promise = new Promise((resolve, reject) => {
    const listener = (event: MessageEvent) => {
      if (event.data.type === "sessionResponse") {
        window.removeEventListener("message", listener);
        resolve(event.data.result);
      } else if (event.data.type === "error") {
        window.removeEventListener("message", listener);
        reject(new Error(event.data.error));
      }
    };
    window.addEventListener("message", listener);
    vscode?.postMessage({ type: "sessionSend", sessionId, message });
  });
  return withTimeout(
    promise,
    30000,
    "sessionSend timed out — AI may be slow or not responding",
  );
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const promise = new Promise<ToolCallResult>((resolve, reject) => {
    const listener = (event: MessageEvent) => {
      if (event.data.type === "toolResult") {
        window.removeEventListener("message", listener);
        resolve(event.data.result as ToolCallResult);
      } else if (event.data.type === "error") {
        window.removeEventListener("message", listener);
        reject(new Error(event.data.error));
      }
    };
    window.addEventListener("message", listener);
    vscode?.postMessage({ type: "callTool", name, args });
  });
  return withTimeout(promise, 10000, "callTool timed out");
}

export function stopCli(): void {
  vscode?.postMessage({ type: "stopCli" });
}
