// =============================================================================
// Bash Tool - Shell command execution with UI rendering
//
// Two modes:
//   foreground (default) — awaits the command, streaming a live tail to the
//     frontend as it runs so a long build isn't a silent spinner.
//   background (`run_in_background: true`) — registers the process in the
//     session's ShellRegistry and returns an id immediately, so a dev server or
//     a long test run stops holding the turn. Drain it with `bashoutput`, stop
//     it with `killbash`.
// =============================================================================

import * as path from "path";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool } from "./factory.js";
import { BASH_DESCRIPTION } from "./bash-prompt.js";
import { classifyCommand } from "./output-compress.js";
import { spawnShell } from "./shells/spawn.js";
import { getShellRegistry } from "./shells/index.js";
import { BusEvents } from "../bus/index.js";

interface BashParams {
  command: string;
  timeout?: number;
  workdir?: string;
  run_in_background?: boolean;
}

const DEFAULT_TIMEOUT = 60_000;

/**
 * How often a running foreground command flushes its tail to the frontend.
 * Coalesced rather than per-chunk: a verbose build emits thousands of writes a
 * second and each one would be an IPC frame plus a TUI re-render.
 */
const LIVE_TAIL_INTERVAL_MS = 200;
/** Lines of tail the frontend shows; matches the loop's post-hoc emit. */
const LIVE_TAIL_LINES = 5;
const MAX_LINE_LEN = 200;

type BashResult = ToolExecutionResult<{
  title: string;
  output: string;
  metadata?: Record<string, unknown>;
}>;

// =============================================================================
// Bash Schema
// =============================================================================

const bashSchema: JsonSchema = {
  type: "object",
  properties: {
    command: { type: "string", description: "The shell command to execute" },
    timeout: {
      type: "number",
      description: "Timeout in milliseconds (default: 60000)",
    },
    workdir: {
      type: "string",
      description: "Working directory for the command",
    },
    run_in_background: {
      type: "boolean",
      description:
        "Run the command in the background and return a shell id immediately instead of waiting. Use for dev servers, watchers, and anything longer than the timeout; read its output with bashoutput and stop it with killbash.",
    },
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
): Promise<BashResult> {
  // Executed via the BashTool definition below; exported separately only for
  // regression tests in `bash.test.ts` so they can call it without building a
  // full ToolContext for the harness.
  return _executeBash(params, ctx);
}

function resolveCwd(params: BashParams, ctx: ToolContext): string {
  if (!params.workdir) return ctx.cwd;
  return path.isAbsolute(params.workdir)
    ? params.workdir
    : path.resolve(ctx.cwd, params.workdir);
}

export async function _executeBash(
  params: BashParams,
  ctx: ToolContext,
): Promise<BashResult> {
  const cwd = resolveCwd(params, ctx);
  // Providers send booleans as strings (see the coercion note in the tool
  // registration checklist), so accept both spellings of true.
  const background =
    params.run_in_background === true ||
    (params.run_in_background as unknown) === "true";

  return background
    ? startBackground(params, ctx, cwd)
    : runForeground(params, ctx, cwd);
}

// =============================================================================
// Background mode
// =============================================================================

function startBackground(
  params: BashParams,
  ctx: ToolContext,
  cwd: string,
): BashResult {
  const sessionId = ctx.sessionId;
  if (!sessionId) {
    return {
      success: false,
      error:
        "run_in_background requires a session; re-run the command in the foreground.",
    };
  }

  const registry = getShellRegistry(sessionId);
  let shell;
  try {
    shell = registry.start({
      command: params.command,
      cwd,
      onData: (id, chunk) => {
        BusEvents.stream(sessionId, {
          type: "shell_output",
          shellId: id,
          chunk,
        });
      },
      onExit: (id, status, exitCode) => {
        if (status === "running") return;
        BusEvents.stream(sessionId, {
          type: "shell_exit",
          shellId: id,
          status,
          exitCode,
        });
      },
    });
  } catch (error) {
    return { success: false, error: String((error as Error).message ?? error) };
  }

  BusEvents.stream(sessionId, {
    type: "shell_start",
    shellId: shell.id,
    command: shell.command,
    cwd: shell.cwd,
  });

  return {
    success: true,
    result: {
      title: params.command.split("\n")[0].slice(0, 50),
      output: [
        `Started in the background as ${shell.id}.`,
        "",
        `Read new output with bashoutput(bash_id: "${shell.id}") — each call returns only what is new.`,
        `Stop it with killbash(bash_id: "${shell.id}").`,
      ].join("\n"),
      metadata: {
        background: true,
        shellId: shell.id,
        command: params.command,
        cwd,
        outputKind: classifyCommand(params.command),
      },
    },
  };
}

// =============================================================================
// Foreground mode
// =============================================================================

function runForeground(
  params: BashParams,
  ctx: ToolContext,
  cwd: string,
): Promise<BashResult> {
  return new Promise((resolve) => {
    const timeout = params.timeout ?? DEFAULT_TIMEOUT;
    const { child, killTree } = spawnShell(params.command, cwd);

    let stdout = "";
    let stderr = "";
    let killed = false;
    let settled = false;

    // Live tail: the frontend shows the last few lines while the command runs,
    // so a three-minute build reports progress instead of looking hung. Only
    // the tail is sent — the full output still goes back at completion.
    const canStream = Boolean(ctx.sessionId && ctx.toolCallId);
    let tailDirty = false;
    const flushTail = (): void => {
      if (!tailDirty || !ctx.sessionId || !ctx.toolCallId) return;
      tailDirty = false;
      const lines = (stdout + stderr)
        .split("\n")
        .filter((l) => l.trim())
        .slice(-LIVE_TAIL_LINES)
        .map((l) =>
          l.length > MAX_LINE_LEN ? l.slice(0, MAX_LINE_LEN) + "..." : l,
        );
      if (lines.length === 0) return;
      BusEvents.stream(ctx.sessionId, {
        type: "tool_output",
        toolCallId: ctx.toolCallId,
        content: lines.join("\n"),
      });
    };
    const tailTimer = canStream
      ? setInterval(flushTail, LIVE_TAIL_INTERVAL_MS)
      : undefined;

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
      if (tailTimer) clearInterval(tailTimer);
    };

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
      tailDirty = true;
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
      tailDirty = true;
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
        result.output += `\n\n<bash_metadata>\nCommand timed out after ${timeout}ms (signal sent). If this command is long-running by design, re-run it with run_in_background: true.\n</bash_metadata>`;
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
