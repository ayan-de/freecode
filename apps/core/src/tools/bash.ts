// =============================================================================
// Bash Tool - Shell command execution with UI rendering
// =============================================================================

import { spawn } from "child_process";
import * as path from "path";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";
import { BASH_DESCRIPTION } from "./bash-prompt.js";
import { classifyCommand } from "./output-compress.js";

interface BashParams {
  command: string;
  timeout?: number;
  workdir?: string;
}

const DEFAULT_TIMEOUT = 60_000;

// =============================================================================
// Bash Schema
// =============================================================================

const bashSchema: JsonSchema = {
  type: "object",
  properties: {
    command: { type: "string", description: "The shell command to execute" },
    timeout: { type: "number", description: "Timeout in milliseconds (default: 60000)" },
    workdir: { type: "string", description: "Working directory for the command" },
  },
  required: ["command"],
};

// =============================================================================
// Input validation
// =============================================================================

function validateBashInput(
  params: unknown,
): { valid: true } | { valid: false; error: string } {
  if (!params || typeof params !== "object") {
    return { valid: false, error: "Expected object parameters" };
  }
  const p = params as Record<string, unknown>;
  if (typeof p.command !== "string" || p.command.length === 0) {
    return { valid: false, error: "command is required and must be a string" };
  }
  if (p.timeout !== undefined && typeof p.timeout !== "number") {
    return { valid: false, error: "timeout must be a number" };
  }
  return { valid: true };
}

// =============================================================================
// Execute function
// =============================================================================

async function executeBash(
  params: BashParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  // Executed via the BashTool definition below; exported separately only for
  // regression tests in `bash.test.ts` so they can call it without building a
  // full ToolContext for the harness.
  return _executeBash(params, ctx);
}

export async function _executeBash(
  params: BashParams,
  ctx: ToolContext,
): Promise<
  ToolExecutionResult<{
    title: string;
    output: string;
    metadata?: Record<string, unknown>;
  }>
> {
  return new Promise((resolve) => {
    const cwd = params.workdir
      ? path.isAbsolute(params.workdir)
        ? params.workdir
        : path.resolve(ctx.cwd, params.workdir)
      : ctx.cwd;

    const timeout = params.timeout ?? DEFAULT_TIMEOUT;

    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "/bin/bash";
    const shellArgs = isWindows
      ? ["/c", params.command]
      : ["-c", params.command];

    // Disable prompts (GIT_TERMINAL_PROMPT, apt/dpkg). stdio[0] is "ignore" so
    // the child gets EOF on stdin immediately — anything that would block on
    // a password prompt (git push over HTTPS, sudo, apt, etc.) will exit with
    // an error instead of hanging past the timeout.
    //
    // `detached` puts the shell in its own process group so the timeout can
    // signal the whole tree. Without it, `npm test` (npm -> vitest -> workers)
    // leaves grandchildren alive after the shell dies.
    const child = spawn(shell, shellArgs, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        DEBIAN_FRONTEND: "noninteractive",
        APT_LISTCHANGES_FRONTEND: "none",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: !isWindows,
    });

    let stdout = "";
    let stderr = "";
    let killed = false;
    let settled = false;

    // Signal the process group, not just the shell, so descendants that
    // outlive it (test runners, dev servers) go down with it. Falls back to
    // the direct child if the group is already gone.
    const killTree = (signal: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        if (isWindows) child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      }
    };

    const killTimer = setTimeout(() => {
      killTree("SIGKILL");
    }, timeout + 3000);

    const timer = setTimeout(() => {
      killed = true;
      killTree("SIGTERM");
    }, timeout);

    let exitGrace: NodeJS.Timeout | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (exitGrace) clearTimeout(exitGrace);
    };

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    // `close` fires only once every stdio pipe is closed — and a surviving
    // grandchild still holds the write end, so it may never fire at all. The
    // tool promise would then never settle and the UI spins forever. Settle
    // shortly after `exit` with whatever was captured; in the normal case
    // `close` wins the race and this timer is cleared.
    child.on("exit", (code, signal) => {
      exitGrace = setTimeout(() => finish(code, signal), 250);
    });

    child.on("close", (code, signal) => {
      finish(code, signal);
    });

    function finish(code: number | null, _signal: NodeJS.Signals | null) {
      if (settled) return;
      settled = true;
      cleanup();

      let output = "";
      if (stdout) output += stdout;
      if (stderr)
        output += (output ? "\n" : "") + "<stderr>\n" + stderr + "\n</stderr>";

      if (!output) {
        output = "(no output)";
      }

      // Returned untruncated: the orchestrator stores the full text in the
      // OutputStore before any lossy cap, so the `output` tool can page the
      // whole thing. Capping here would leave the store holding an
      // already-cut copy (spec 2026-09-04-harness-cost-efficiency.md D1).
      const result = {
        title: params.command.split("\n")[0].slice(0, 50),
        output,
        metadata: {
          exitCode: code,
          command: params.command,
          cwd,
          // Classified here — the tool knows what was run — but acted on at
          // the orchestrator's cap site (spec 2026-09-04 D2).
          outputKind: classifyCommand(params.command),
        },
      };

      if (killed) {
        result.output += `\n\n<bash_metadata>\nCommand timed out after ${timeout}ms (signal sent)\n</bash_metadata>`;
        // Surface the timeout as a failure so the loop sees it as such and
        // doesn't conclude "the command ran successfully, just slowly." The
        // partial output (stdout/stderr captured before the kill) goes into
        // the error message so the UI can still render it.
        resolve({
          success: false,
          error: `Command timed out after ${timeout}ms`,
          code: `TIMEOUT_${timeout}`,
        });
        return;
      }

      resolve({ success: true, result });
    }

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        success: false,
        error: `Error executing command: ${err.message}`,
      });
    });
  });
}

// =============================================================================
// BashTool - Built with buildTool() factory
// =============================================================================

export const BashTool: Tool<BashParams> = buildTool({
  id: "bash",
  description: BASH_DESCRIPTION,
  schemas: {
    parameters: bashSchema,
  },
  permissions: {
    operations: ["shell"],
    requiresApproval: true,
  },
  behavior: {
    isConcurrencySafe: false,
    // A shell command can mutate the filesystem (sed -i, git apply, a
    // codemod), so this must read the same as write/edit: triggers the
    // verify gate, counts toward stagnation, and is not safely retryable.
    isDestructive: true,
    interruptBehavior: "await",
    userFacingName: "Bash",
  },
  execute: executeBash,
  validateInput: validateBashInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
});
