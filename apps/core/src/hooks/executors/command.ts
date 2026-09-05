// =============================================================================
// Command Executor - Execute shell command hooks
// =============================================================================

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { EventEmitter } from "events";
import type {
  HookContext,
  HookExecutionResult,
  ToolCallInput,
} from "../types.js";

const HOOK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes default

export interface CommandExecutorOptions {
  shell?: "bash" | "powershell";
  timeout?: number;
}

export async function executeCommandHook(
  command: string,
  input: ToolCallInput,
  context: HookContext,
  options: CommandExecutorOptions = {},
): Promise<HookExecutionResult> {
  const timeout = options.timeout || HOOK_TIMEOUT_MS;

  return new Promise((resolve) => {
    const shell = options.shell === "powershell" ? "pwsh" : "bash";
    const shellArgs =
      options.shell === "powershell"
        ? ["-NoProfile", "-NonInteractive", "-Command", command]
        : ["-c", command];

    // Build environment
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
    };
    env.CLAUDE_SESSION_ID = context.sessionId;
    env.CLAUDE_TOOL_NAME = input.toolName;
    env.CLAUDE_TOOL_INPUT = JSON.stringify(input.toolInput);
    // PostToolUse only: the tool's output, already capped by the producer.
    if (typeof input.result === "string") {
      env.CLAUDE_TOOL_OUTPUT = input.result;
    }
    if (typeof context.cwd === "string") env.CLAUDE_CWD = context.cwd;
    if (typeof context.agentId === "string")
      env.CLAUDE_AGENT_ID = context.agentId;
    if (typeof context.agentType === "string")
      env.CLAUDE_AGENT_TYPE = context.agentType;

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      resolve({
        success: false,
        blocked: undefined as never,
        error: `Hook timed out after ${timeout}ms`,
      });
    }, timeout);

    const child: ChildProcessWithoutNullStreams = spawn(shell, shellArgs, {
      env,
      cwd: typeof context.cwd === "string" ? context.cwd : undefined,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);

      if (timedOut) {
        return; // Already resolved with timeout error
      }

      const trimmed = stdout.trim();
      let parsed: {
        block?: boolean;
        reason?: string;
        modifiedInput?: Record<string, unknown>;
        modifiedOutput?: unknown;
        context?: string;
      } | undefined;
      if (trimmed.startsWith("{")) {
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // Not JSON, treat as plain text
        }
      }

      // Exit code 2 = blocking error (special hook protocol)
      if (code === 2) {
        resolve({
          success: false,
          blocked: true,
          blockReason: stderr || stdout || "Hook blocked execution",
        });
        return;
      }

      // Any other non-zero exit blocks too, JSON output or not. Parsing JSON
      // before checking the code let `{"block":false}` + exit 1 continue,
      // which made the exit code meaningless in exactly the fail-closed
      // direction it exists for. The JSON still contributes its reason.
      if (code !== 0) {
        resolve({
          success: false,
          blocked: true,
          blockReason: parsed?.reason || `Exit code ${code}`,
        });
        return;
      }

      if (parsed) {
        if (parsed.block === true) {
          resolve({
            success: false,
            blocked: true,
            blockReason: parsed.reason,
          });
        } else {
          resolve({
            success: true,
            modifiedInput: parsed.modifiedInput,
            modifiedOutput: parsed.modifiedOutput,
            additionalContext: parsed.context,
          });
        }
        return;
      }

      resolve({
        success: true,
        additionalContext: trimmed || undefined,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        blocked: undefined as never,
        error: err.message,
      });
    });
  });
}
