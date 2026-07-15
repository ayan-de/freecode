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

export interface ProviderToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

let cached: ProviderToolDef[] | null = null;
let subscribed = false;

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  bus.subscribe("tools.changed", invalidateToolDefs);
  bus.subscribe("mcp.tools.changed", invalidateToolDefs);
}

export function getToolDefs(): ProviderToolDef[] {
  ensureSubscribed();
  if (!cached) {
    cached = listTools().map((t) => {
      const toolDef = getTool(t.id);
      return {
        name: t.id,
        description: t.description,
        parameters: (toolDef?.schemas.parameters ?? {
          type: "object",
          properties: {},
        }) as unknown as Record<string, unknown>,
      };
    });
  }
  return cached;
}

export function invalidateToolDefs(): void {
  cached = null;
  // Tools are sent as native schemas now, so only the compiler's file-tree
  // cache remains; dropping it on a rare tool/skill change is acceptable.
  PromptCompiler.clearCaches();
}
