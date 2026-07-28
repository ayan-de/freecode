// =============================================================================
// rtk bash-rewrite hook — rewrites bash commands to their compact rtk
// equivalents before execution (e.g. `ls` → `rtk ls`), cutting the output the
// model has to read. Optional: no-op unless rtk resolves (see rtk-installer.ts)
// and off entirely when FREECODE_RTK=0. Only touches the `bash` tool.
// =============================================================================

import { registerHook } from "../registry.js";
import type { HookResult, ToolCallInput, HookContext } from "../types.js";
import { ensureRtk, runCapture } from "./rtk-installer.js";

// Ask rtk for a compressed equivalent of `command`. Exit-code contract of
// `rtk rewrite`: 0 or 3 + stdout → rewrite; 1 / timeout / empty → pass through.
export async function rewriteCommand(
  cmd: string,
  command: string,
): Promise<string | null> {
  const r = await runCapture(cmd, ["rewrite", command], { timeout: 2000 });
  if (r.killed) return null;
  if (r.code !== 0 && r.code !== 3) return null;
  const out = r.stdout.trim(); // the rewrite is stdout-only; rtk's advisory nag goes to stderr
  return out.length > 0 ? out : null;
}

async function rtkPreToolUse(
  input: ToolCallInput,
  context: HookContext,
): Promise<HookResult> {
  const command = input.toolInput.command;
  if (typeof command !== "string" || command.length === 0) {
    return { action: "continue" };
  }

  const rtk = await ensureRtk(context.sessionId);
  if (!rtk) return { action: "continue" };

  const rewritten = await rewriteCommand(rtk, command);
  if (!rewritten || rewritten === command) return { action: "continue" };

  return { action: "modify", modifiedInput: { command: rewritten } };
}

// Register the rtk bash-rewrite hook. The callback lazily resolves/installs rtk
// on first bash use, so startup stays fast and offline-safe.
export function registerRtkHook(): void {
  if (process.env.FREECODE_RTK === "0") return;
  registerHook(
    "PreToolUse",
    "rtk-rewrite",
    { type: "callback", callback: rtkPreToolUse, internal: true },
    "settings",
    { matcher: "bash" },
  );
}
