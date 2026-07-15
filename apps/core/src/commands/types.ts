// =============================================================================
// Prompt Commands — single source of truth for slash commands whose "logic"
// is really a prompt template sent to the agent (e.g. /init, /review).
//
// UI-only commands (/clear, /model, /exit) are NOT modeled here — they live in
// each frontend because they manipulate frontend state, not the agent.
// =============================================================================

export interface CommandResolveContext {
  /** Working directory of the session (repo root). */
  cwd: string;
  /** Positional args typed after the command, e.g. `/init focus on tests`. */
  args: string[];
}

export interface PromptCommand {
  name: string;
  description: string;
  /** Hint shown in autocomplete for expected arguments, e.g. "[focus]". */
  argHint?: string;
  /** Build the prompt string sent to the agent. */
  template(ctx: CommandResolveContext): string;
}
