import type { CommandResolveContext } from "../types.js";

// The /distill prompt. This is a thin wrapper that gets the model to call the
// `distill` tool with whatever the user typed as focus — the actual review
// and edit logic lives in harness/planner.ts, not here. Kept as a TS string
// (not a .md asset) so it survives bundling, same reasoning as init.ts.
export function distillTemplate(ctx: CommandResolveContext): string {
  const focus = ctx.args.join(" ").trim();
  return `Call the \`distill\` tool now to review this session for the continual harness.

${
  focus
    ? `Focus the review on: ${focus}`
    : "No specific focus was given — review the whole session for anything worth remembering: a repeated failure, a corrected assumption, a procedure worth naming, or a reusable delegation role."
}

Use \`scope: "local"\` (the default) unless what you found is genuinely true regardless of what's asked next, in which case use \`scope: "global"\`. If you're unsure, prefer local.

If nothing durable happened this session, it is correct and expected for the distillation to come back with no edits — do not force a lesson that isn't there.`;
}
