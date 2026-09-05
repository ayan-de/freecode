// =============================================================================
// Hook Bootstrap - the one place hooks are turned on for a process
// Both `freecode serve` (server.ts) and `freecode run` (cli/commands/run.ts)
// call this. They used to diverge: the manager was constructed inside
// startServer() only, so a headless run loaded no settings.json hooks and never
// registered the rtk rewrite — the same repo behaved differently under `serve`
// and under `run`, and a formatter that fired after every interactive edit
// silently did not fire in CI.
// =============================================================================

import { registerRtkHook } from "./builtin/rtk-rewrite.js";
import { HookSettingsManager } from "./settings.js";

export interface HookBootstrapOptions {
  /**
   * Reload hooks when settings.json changes. True for the long-lived daemon;
   * false for a one-shot run, which exits before an edit could matter and
   * would otherwise hold an fs watcher open past its last turn.
   */
  watch?: boolean;
}

/**
 * Register built-in hooks and load `settings.json` hooks for `projectRoot`.
 * Returns the manager so the caller can dispose it on shutdown.
 */
export function initHooks(
  projectRoot: string,
  options: HookBootstrapOptions = {},
): HookSettingsManager {
  // Optional rtk integration: rewrites bash commands to compact `rtk`
  // equivalents to save tokens. No-op unless rtk resolves; FREECODE_RTK=0 opts out.
  registerRtkHook();

  const hookSettings = new HookSettingsManager(projectRoot);
  hookSettings.load();
  if (options.watch) hookSettings.watch();
  return hookSettings;
}
