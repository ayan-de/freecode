// =============================================================================
// IPC Client — JSON-RPC bridge to CLI backend
// =============================================================================

import { spawn, type ChildProcess } from "child_process";
import { resolve as pathResolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readdirSync, statSync } from "fs";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  ToolListItem,
  ToolResult,
  SessionConfig,
  ProviderInfo,
  CommandInfo,
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
let stderrHandler: ((msg: string) => void) | null = null;

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

function newestMtimeMs(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = pathResolve(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? newestMtimeMs(full) : statSync(full).mtimeMs,
    );
  }
  return newest;
}

export function startCli(onStderr?: (msg: string) => void): void {
  if (onStderr) stderrHandler = onStderr;
  if (cliProcess) return;

  if (process.env.FREECODE_BUNDLED === "1") {
    // Distributed single-file binary: the backend is baked into this same
    // executable. Re-exec ourselves with the `serve` subcommand and run it
    // in the user's current directory (their project), not a repo root.
    cliProcess = spawn(process.execPath, ["serve"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
  } else {
    // Dev / monorepo: spawn the core backend from source or built dist.
    // Project root is the monorepo root (where pnpm-workspace.yaml lives).
    // Walk up from the start dir to find it, rather than assuming a fixed
    // number of levels (running from an arbitrary cwd used to resolve to `/`).
    const startDir = process.env.FREECODE_ROOT || process.cwd();
    let projectRoot = startDir;
    let dir = startDir;
    for (;;) {
      if (existsSync(`${dir}/pnpm-workspace.yaml`)) {
        projectRoot = dir;
        break;
      }
      const parent = pathResolve(dir, "..");
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }

    // Prefer the pre-built core (node, fast); fall back to tsx transpiling
    // source on the fly (dev mode, ~150-300 ms slower per boot).
    const distPath = pathResolve(projectRoot, "apps/core/dist/server.js");
    const srcDir = pathResolve(projectRoot, "apps/core/src");

    // A non-bundled binary can only run from inside the repo. If neither the
    // built dist nor the source exists, this is almost certainly a SEA/dev
    // build copied outside the monorepo — fail loudly instead of spawning
    // `npx tsx <bad path>` and surfacing a cryptic ERR_MODULE_NOT_FOUND.
    if (!existsSync(distPath) && !existsSync(pathResolve(srcDir, "server.ts"))) {
      throw new Error(
        "[freecode] could not locate the core backend. This build must run " +
          "from the monorepo root (or set FREECODE_ROOT). If you installed " +
          "freecode, reinstall the release binary: " +
          "curl -fsSL https://freecode.ayande.xyz/install | bash",
      );
    }

    if (existsSync(distPath)) {
      try {
        if (statSync(distPath).mtimeMs < newestMtimeMs(srcDir)) {
          stderrHandler?.(
            "[freecode] apps/core/dist is older than src — run `pnpm --filter @thisisayande/freecode-core build`",
          );
        }
      } catch {
        // Staleness check is best-effort only
      }
      cliProcess = spawn("node", [distPath], {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } else {
      cliProcess = spawn("npx", ["tsx", pathResolve(srcDir, "server.ts")], {
        cwd: projectRoot,
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
  }

  cliProcess.stdout?.setEncoding("utf-8");

  cliProcess.stderr?.on("data", (data) => {
    stderrHandler?.(data.toString().trim());
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

function sendRequest(
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!cliProcess || !cliProcess.stdin) {
      reject(new Error("CLI not running"));
      return;
    }

    const id = generateId();
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });

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

export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return (await sendRequest("tools.call", { name, args })) as ToolResult;
}

// =============================================================================
// Session Methods
// =============================================================================

export interface SessionInfo {
  sessionId: string;
}

export async function sessionStart(
  config: SessionConfig,
): Promise<SessionInfo> {
  return (await sendRequest(
    "session.start",
    config as unknown as Record<string, unknown>,
  )) as SessionInfo;
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
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    contextTokens?: number;
  };
}

export async function sessionSend(
  sessionId: string,
  message: string,
  model?: string,
): Promise<SessionSendResult> {
  return (await sendRequest("session.send", {
    sessionId,
    message,
    model,
  })) as SessionSendResult;
}

export async function sessionSendStreaming(
  sessionId: string,
  message: string,
  model: string | undefined,
  agentMode: string | undefined,
  onEvent: (event: StreamEvent) => void,
): Promise<SessionSendResult> {
  return new Promise((resolve, reject) => {
    if (!cliProcess || !cliProcess.stdin) {
      reject(new Error("CLI not running"));
      return;
    }

    onStreamEvent = onEvent;

    const id = generateId();
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method: "session.send",
      params: { sessionId, message, model, agentMode },
    };
    pendingRequests.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    cliProcess.stdin.write(JSON.stringify(request) + "\n");
  });
}

// =============================================================================
// Question Reply Methods
// =============================================================================

export async function answerQuestion(
  requestId: string,
  answers: string[],
): Promise<void> {
  await sendRequest("question.answer", { requestId, answers });
}

export async function rejectQuestion(requestId: string): Promise<void> {
  await sendRequest("question.reject", { requestId });
}

// =============================================================================
// Permission Reply Methods
// =============================================================================

export async function answerPermission(
  requestId: string,
  decision:
    | "allow-once"
    | "allow-session"
    | "allow-project"
    | "allow-always"
    | "deny",
  editedRule?: string,
): Promise<void> {
  await sendRequest("permission.answer", { requestId, decision, editedRule });
}

export async function rejectPermission(requestId: string): Promise<void> {
  await sendRequest("permission.reject", { requestId });
}

// =============================================================================
// Provider Methods
// =============================================================================

export async function listProviders(): Promise<ProviderInfo[]> {
  return (await sendRequest("providers.list")) as ProviderInfo[];
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
}

export async function listModels(providerId: string): Promise<ModelInfo[]> {
  return (await sendRequest("models.list", { providerId })) as ModelInfo[];
}

// Prompt commands (e.g. /init) — defined once in core, fetched by every frontend.
export async function listCommands(): Promise<CommandInfo[]> {
  return (await sendRequest("commands.list")) as CommandInfo[];
}

export async function resolveCommand(
  name: string,
  args: string[],
): Promise<string> {
  const { prompt } = (await sendRequest("commands.resolve", {
    name,
    args,
  })) as { prompt: string };
  return prompt;
}

export interface ConfigInfo {
  providers?: Record<string, { apiKey?: string }>;
  current?: { provider: string; model: string };
}

export async function getConfig(): Promise<ConfigInfo> {
  return (await sendRequest("config.get")) as ConfigInfo;
}

export async function setApiKey(
  provider: string,
  apiKey: string,
  model?: string,
): Promise<void> {
  await sendRequest("config.setApiKey", { provider, apiKey, model });
}

export async function setCurrentModel(
  provider: string,
  model: string,
): Promise<void> {
  await sendRequest("config.setCurrentModel", { provider, model });
}

export async function getCurrentModel(): Promise<
  { provider: string; model: string } | undefined
> {
  return (await sendRequest("config.getCurrentModel")) as
    | { provider: string; model: string }
    | undefined;
}

// =============================================================================
// Session List/Resume Methods
// =============================================================================

export interface SessionMeta {
  id: string;
  title: string;
  projectPath: string;
  provider: string;
  model?: string;
  status: "active" | "interrupted" | "archived" | "deleted";
  createdAt: number;
  updatedAt: number;
  lastTurnAt: number;
  turnCount: number;
  parentId?: string;
  aggregatedTokenCount?: number;
}

export interface SessionFilter {
  status?: "active" | "interrupted" | "archived" | "deleted";
  projectPath?: string;
}

export async function sessionList(
  filter?: SessionFilter,
): Promise<SessionMeta[]> {
  return (await sendRequest(
    "session.list",
    filter as Record<string, unknown>,
  )) as SessionMeta[];
}

export async function sessionResume(
  sessionId: string,
  agentMode?: string,
): Promise<{ sessionId: string; messages?: SerializedMessage[] }> {
  return (await sendRequest("session.resume", { sessionId, agentMode })) as {
    sessionId: string;
    messages?: SerializedMessage[];
  };
}

export interface SerializedMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{
    type: "text" | "code" | "tool";
    content?: string;
    language?: string;
    tool?: { name: string; args: Record<string, unknown> };
    result?: string;
  }>;
  timestamp: number;
  interrupted?: boolean;
}
