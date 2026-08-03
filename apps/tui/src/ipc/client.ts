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
  SessionMeta,
  SessionFilter,
  SessionResumeResult,
  ClaudeSessionMeta,
  ClaudeTranscript,
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
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  /** Restart the idle deadline — see `registerPending`. */
  touch: () => void;
}
let pendingRequests = new Map<number | string, PendingRequest>();
let onStreamEvent: ((event: StreamEvent) => void) | null = null;
let stderrHandler: ((msg: string) => void) | null = null;
/**
 * Id of the in-flight streaming call, if any. Stream events carry no id of
 * their own, and only one turn streams at a time (`onStreamEvent` is a single
 * slot), so this is what lets an event reset that call's deadline.
 */
let activeStreamId: number | string | null = null;

/**
 * Per-request timeout. Core hangs used to leave the TUI spinning forever
 * with no recovery and no restart — every JSON-RPC call now gets a
 * deadline, and any in-flight call whose core process exits is rejected
 * outright (see the error/exit handlers below).
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Idle deadline for `session.send`. That call resolves only when the whole
 * agent turn is done, so a total timeout would kill every turn longer than
 * it — this one is reset by each stream event instead, and fires only when
 * core has gone completely silent.
 *
 * It has to clear the longest a turn can legitimately be quiet: bash takes a
 * caller-supplied `timeout` with no upper bound (default 60s), and a single
 * tool call emits nothing between `tool_start` and `tool_complete`. Ten
 * minutes leaves that room while still bounding a wedged backend.
 */
const STREAM_IDLE_TIMEOUT_MS = 600_000;

// -----------------------------------------------------------------------------
// Backend supervision
//
// A core that dies used to end the session: calls reject honestly now, but the
// TUI had no way back short of quitting. These respawn it, with a bounded
// budget so a backend that cannot start (bad config, missing binary) reports
// that instead of fork-bombing.
// -----------------------------------------------------------------------------

/** Set by stopCli() so a shutdown we asked for is never treated as a crash. */
let shuttingDown = false;
let restartAttempts = 0;
let spawnedAt = 0;
let onCliRestart: (() => void) | null = null;

const RESTART_BACKOFF_MS = [250, 1_000, 3_000];
const MAX_RESTART_ATTEMPTS = RESTART_BACKOFF_MS.length;

/**
 * A backend that ran this long before dying was healthy, not crash-looping, so
 * its death gets a fresh budget. Without this, three unrelated crashes over a
 * long day would permanently exhaust the retries.
 */
const HEALTHY_UPTIME_MS = 60_000;

/**
 * Called after a successful respawn. Core keeps its session map in memory, so
 * the new process knows nothing about the session the UI is still showing —
 * the frontend has to re-resume it before the next turn can work.
 */
export function setCliRestartHandler(handler: () => void): void {
  onCliRestart = handler;
}

function scheduleRestart(): void {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    stderrHandler?.(
      "[freecode] core backend keeps exiting — giving up. Restart freecode.",
    );
    return;
  }
  const delay = RESTART_BACKOFF_MS[restartAttempts] ?? 3_000;
  restartAttempts++;
  const attempt = restartAttempts;

  setTimeout(() => {
    if (shuttingDown || cliProcess) return;
    startCli();
    if (cliProcess) {
      stderrHandler?.(
        `[freecode] core backend restarted (attempt ${attempt}/${MAX_RESTART_ATTEMPTS}).`,
      );
      onCliRestart?.();
    }
  }, delay);
}

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
        // Proof of life for the turn in flight: push its deadline out.
        if (activeStreamId !== null) {
          pendingRequests.get(activeStreamId)?.touch();
        }
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
    if (
      !existsSync(distPath) &&
      !existsSync(pathResolve(srcDir, "server.ts"))
    ) {
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
    // console.* would write raw text straight into the alt-screen frame and
    // corrupt the differential render that render-guard.ts exists to
    // protect; route through stderrHandler instead.
    stderrHandler?.(`[freecode] core process error: ${err.message}`);
    rejectAllPending(`CLI process error: ${err.message}`);
    cliProcess = null;
  });

  cliProcess.on("exit", (code) => {
    stderrHandler?.(
      `[freecode] core process exited (code ${code ?? "null"})`,
    );
    rejectAllPending(`CLI process exited (code ${code ?? "null"})`);
    cliProcess = null;
    activeStreamId = null;
    // A backend that stayed up this long wasn't crash-looping; don't spend the
    // retry budget accumulated over a whole session on it.
    if (Date.now() - spawnedAt > HEALTHY_UPTIME_MS) restartAttempts = 0;
    if (!shuttingDown) scheduleRestart();
  });

  spawnedAt = Date.now();
}

/**
 * Reject every in-flight JSON-RPC call with the given reason. Called when
 * the core process dies so callers don't hang forever waiting for a reply
 * that will never come.
 */
function rejectAllPending(reason: string): void {
  if (pendingRequests.size === 0) return;
  const err = new Error(reason);
  for (const pending of pendingRequests.values()) {
    pending.reject(err);
  }
  pendingRequests.clear();
}

/**
 * Track an in-flight JSON-RPC call and arm its deadline.
 *
 * The deadline is an *idle* one: `touch()` restarts it. Plain request/response
 * calls never touch it, so it behaves as a flat timeout; `session.send`
 * restarts it on every stream event (see `parseResponse`), so a turn that
 * keeps producing output runs as long as it needs while a core that has gone
 * silent is still caught.
 *
 * On expiry the entry is dropped from the map *before* rejecting, so a late
 * response can't settle the same promise twice — nor can the process
 * error/exit handlers, which only walk what's still in the map.
 */
function registerPending(
  id: number | string,
  method: string,
  timeoutMs: number,
  settle: { resolve: (value: unknown) => void; reject: (error: Error) => void },
): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const disarm = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const arm = (): void => {
    disarm();
    timer = setTimeout(() => {
      timer = null;
      if (pendingRequests.delete(id)) {
        settle.reject(
          new Error(`Request "${method}" timed out after ${timeoutMs}ms`),
        );
      }
    }, timeoutMs);
  };

  pendingRequests.set(id, {
    resolve: (value) => {
      disarm();
      settle.resolve(value);
    },
    reject: (err) => {
      disarm();
      settle.reject(err);
    },
    touch: arm,
  });
  arm();
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
    registerPending(id, method, REQUEST_TIMEOUT_MS, { resolve, reject });

    cliProcess.stdin.write(JSON.stringify(request) + "\n");
  });
}

export function stopCli(): void {
  // Latch before killing: the exit handler must see this as a shutdown we
  // asked for, or it will helpfully respawn the backend we're tearing down.
  shuttingDown = true;
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

export interface CompactResult {
  compacted: boolean;
  tokensBefore: number;
  tokensAfter: number;
  reason?: string;
}

export async function sessionCompact(
  sessionId: string,
): Promise<CompactResult> {
  return (await sendRequest("session.compact", { sessionId })) as CompactResult;
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
  images?: Array<{ data: string; mediaType: string; altText?: string }>,
): Promise<SessionSendResult> {
  return (await sendRequest("session.send", {
    sessionId,
    message,
    model,
    images,
  })) as SessionSendResult;
}

export async function sessionSendStreaming(
  sessionId: string,
  message: string,
  model: string | undefined,
  agentMode: string | undefined,
  images:
    | Array<{ data: string; mediaType: string; altText?: string }>
    | undefined,
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
      params: { sessionId, message, model, agentMode, images },
    };
    // Idle deadline, not a total one — this promise settles only when the
    // whole turn is done, which is unbounded by design.
    activeStreamId = id;
    registerPending(id, "session.send", STREAM_IDLE_TIMEOUT_MS, {
      resolve: (value) => {
        activeStreamId = null;
        resolve(value as SessionSendResult);
      },
      reject: (err) => {
        activeStreamId = null;
        reject(err);
      },
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
  limit?: { context: number; output: number };
}

export async function listModels(providerId: string): Promise<ModelInfo[]> {
  return (await sendRequest("models.list", { providerId })) as ModelInfo[];
}

/**
 * Context-window size for a model, resolved by core from models.dev (the
 * single source of truth). Returns 0 when the model is unknown.
 */
export async function getModelContextLimit(
  provider: string,
  model: string,
): Promise<number> {
  return (await sendRequest("models.contextLimit", {
    provider,
    model,
  })) as number;
}

// Prompt commands (e.g. /init) — defined once in core, fetched by every frontend.
export async function listCommands(
  projectPath: string,
): Promise<CommandInfo[]> {
  return (await sendRequest("commands.list", { projectPath })) as CommandInfo[];
}

export async function resolveCommand(
  name: string,
  args: string[],
  projectPath: string,
): Promise<string> {
  const { prompt } = (await sendRequest("commands.resolve", {
    name,
    args,
    projectPath,
  })) as { prompt: string };
  return prompt;
}

/** Per-day token totals for the `/usage` heatmap. Core owns the storage. */
export async function getUsage(): Promise<
  { date: string; tokencount: number }[]
> {
  return (await sendRequest("usage.get")) as {
    date: string;
    tokencount: number;
  }[];
}

export interface SkillInfo {
  name: string;
  description?: string;
  scope: string;
}

/** Available skills (name/description/scope) for the current project. Core owns discovery. */
export async function listSkills(): Promise<SkillInfo[]> {
  return (await sendRequest("skills.list", {
    projectPath: process.cwd(),
  })) as SkillInfo[];
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

export async function getLastAgentMode(): Promise<string | undefined> {
  return (await sendRequest("config.getLastAgentMode")) as string | undefined;
}

export async function setLastAgentMode(mode: string): Promise<void> {
  await sendRequest("config.setLastAgentMode", { mode });
}

// =============================================================================
// Session List/Resume Methods
// =============================================================================

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
): Promise<SessionResumeResult> {
  return (await sendRequest("session.resume", { sessionId, agentMode })) as SessionResumeResult;
}

// =============================================================================
// Claude Code Session Methods (read-only — see
// docs/superpowers/specs/2026-08-02-resume-modal-claude-code-tab.md)
// =============================================================================

export async function sessionClaudeList(
  filter?: { projectPath?: string; limit?: number },
): Promise<ClaudeSessionMeta[]> {
  return (await sendRequest(
    "session.claudeList",
    filter as Record<string, unknown>,
  )) as ClaudeSessionMeta[];
}

export async function sessionClaudeTranscript(
  sessionId: string,
): Promise<ClaudeTranscript> {
  return (await sendRequest("session.claudeTranscript", {
    sessionId,
  })) as ClaudeTranscript;
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

/**
 * Get MCP server status from the running daemon.
 * Returns live status only when daemon is running (TUI/VSCode active).
 */
export async function mcpStatus(name?: string): Promise<McpServerStatus[]> {
  return (await sendRequest(
    "mcp.status",
    name ? { name } : {},
  )) as McpServerStatus[];
}
