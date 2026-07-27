// =============================================================================
// Output Tool UI - minimal renderer for the `output` retrieval tool.
// =============================================================================

import type { ToolUI } from "../tool.types.js";

export const outputToolUI: Partial<ToolUI> = {
  renderToolUseTag(toolId, args) {
    const id = (args?.id as string | undefined) ?? "";
    const suffix = args?.pattern ? ` /${args.pattern}/` : id ? ` ${id}` : "";
    return { label: `output${suffix}`, color: "blue" };
  },
};
