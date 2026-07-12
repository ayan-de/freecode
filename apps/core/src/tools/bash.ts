// =============================================================================
// Bash Tool - Shell command execution with UI rendering
// =============================================================================

import { spawn } from "child_process";
import * as path from "path";
import type { ToolContext } from "./types.js";
import type { Tool, ToolExecutionResult, JsonSchema } from "./tool.types.js";
import { buildTool, defaultToolUI } from "./factory.js";
import { bashToolUI } from "./bash/ui.js";

interface BashParams {
  command: string;
  timeout?: number;
  workdir?: string;
}

const DEFAULT_TIMEOUT = 60_000;
const MAX_OUTPUT_BYTES = 500_000;

// =============================================================================
// Bash Schema
// =============================================================================

const bashSchema: JsonSchema = {
  type: "object",
  properties: {
    command: { description: "The shell command to execute" },
    timeout: { description: "Timeout in milliseconds (default: 60000)" },
    workdir: { description: "Working directory for the command" },
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
// truncateOutput
// =============================================================================

function truncateOutput(
  output: string,
  maxBytes: number = MAX_OUTPUT_BYTES,
): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(output, "utf-8");
  if (bytes <= maxBytes) {
    return { text: output, truncated: false };
  }

  const lines = output.split("\n");
  const truncated: string[] = [];
  let byteCount = 0;

  for (let i = lines.length - 1; i >= 0; i--) {
    const lineBytes = Buffer.byteLength(lines[i], "utf-8") + 1;
    if (byteCount + lineBytes > maxBytes) {
      if (truncated.length === 0) {
        const buf = Buffer.from(lines[i], "utf-8");
        const available = maxBytes - byteCount - 5;
        if (available > 0) {
          truncated.unshift(
            "..." + buf.subarray(buf.length - available).toString("utf-8"),
          );
        }
      }
      break;
    }
    truncated.unshift(lines[i]);
    byteCount += lineBytes;
  }

  return {
    text: truncated.join("\n") + "\n[output truncated]",
    truncated: true,
  };
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

    const child = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env },
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 3000);
    }, timeout);

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      let output = "";
      if (stdout) output += stdout;
      if (stderr)
        output += (output ? "\n" : "") + "<stderr>\n" + stderr + "\n</stderr>";

      if (!output) {
        output = "(no output)";
      }

      const truncated = truncateOutput(output);

      const result = {
        title: params.command.split("\n")[0].slice(0, 50),
        output: truncated.text,
        metadata: {
          exitCode: code,
          truncated: truncated.truncated,
          command: params.command,
          cwd,
        },
      };

      if (killed) {
        result.output += `\n\n<bash_metadata>\nCommand timed out after ${timeout}ms\n</bash_metadata>`;
      }

      resolve({ success: true, result });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
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
  description: "Execute shell commands",
  schemas: {
    parameters: bashSchema,
  },
  permissions: {
    operations: ["shell"],
    requiresApproval: true,
  },
  behavior: {
    isConcurrencySafe: false,
    isDestructive: false,
    interruptBehavior: "await",
    userFacingName: "Bash",
  },
  ui: {
    ...defaultToolUI,
    ...bashToolUI,
  },
  execute: executeBash,
  validateInput: validateBashInput,
  isSearchOrReadCommand: () => ({ isSearch: false, isRead: false }),
});
