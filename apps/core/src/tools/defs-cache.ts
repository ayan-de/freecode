// =============================================================================
// Tool Defs Cache — memoized provider-facing tool definitions (Phase 5)
// PRIMARY: Avoids rebuilding the { name, description, parameters } array on
//          every turn (it was computed twice per turn: prompt compile + send)
// INVALIDATION: Bus events `tools.changed` / `mcp.tools.changed` — the only
//          runtime sources of tool-set mutation (skills register through the
//          same registry and emit tools.changed).
// =============================================================================

import { listTools, getTool } from "./index.js";
import { bus } from "../bus/index.js";
import { PromptCompiler } from "../context/compiler.js";
import { isReadOnlyMode, modeEnforcement } from "../permission/mode-policy.js";
import type { AgentMode } from "../agent/types.js";

export interface ProviderToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

let cachedAll: ProviderToolDef[] | null = null;
// A read-only mode's filtered view, keyed by mode — small (plan/review/explore
// only) and rebuilt from cachedAll, so invalidation only needs to clear both.
const cachedReadOnly = new Map<AgentMode, ProviderToolDef[]>();
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  bus.subscribe("tools.changed", invalidateToolDefs);
  bus.subscribe("mcp.tools.changed", invalidateToolDefs);
}

function buildAll(): ProviderToolDef[] {
  return listTools()
    .map((t) => {
      const toolDef = getTool(t.id);
      return {
        name: t.id,
        description: t.description,
        parameters: (toolDef?.schemas.parameters ?? {
          type: "object",
          properties: {},
        }) as unknown as Record<string, unknown>,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Provider-facing tool list, pruned to the tools a read-only mode
 * (plan/review/explore) could actually run — otherwise the model routinely
 * calls `write`/`edit`/`bash`, learns only from the hard-deny at execution
 * time, and burns a full round trip finding out (fixed docs-audit gap, TODO.md).
 */
export function getToolDefs(mode?: AgentMode): ProviderToolDef[] {
  ensureSubscribed();
  if (!cachedAll) cachedAll = buildAll();
  if (!mode || !isReadOnlyMode(mode)) return cachedAll;

  let filtered = cachedReadOnly.get(mode);
  if (!filtered) {
    // modeEnforcement, not raw toolKind: review mode carves out `bash` for
    // rule-allowed read-only commands, and that carve-out must stay in sync
    // with permission/mode-policy.ts rather than be re-derived here.
    filtered = cachedAll.filter(
      (t) => modeEnforcement(mode, t.name) === undefined,
    );
    cachedReadOnly.set(mode, filtered);
  }
  return filtered;
}

export function invalidateToolDefs(): void {
  cachedAll = null;
  cachedReadOnly.clear();
  // Tools are sent as native schemas now, so only the compiler's file-tree
  // cache remains; dropping it on a rare tool/skill change is acceptable.
  PromptCompiler.clearCaches();
}
