// =============================================================================
// Browser Chat — shared types
// Spec: docs/superpowers/specs/2026-08-19-browser-chat-provider.md
// =============================================================================

/** A chat website we can drive. One SiteAdapter per id (Phase 1+). */
export type SiteId = "claude" | "chatgpt";

export interface BrowserChatConfig {
  /**
   * "extension" drives a tab in the user's own browser via apps/extension.
   * "cdp" launches a separate browser — simpler, but bot protection on
   * claude.ai blocks it (spec, 2026-08-20 finding).
   */
  transport: "extension" | "cdp";
  /** Port the extension bridge server listens on (127.0.0.1 only). */
  bridgePort: number;
  /** CDP endpoint. Auto-launch targets this port when nothing answers on it. */
  cdpUrl: string;
  /**
   * Start a browser automatically when nothing is listening on cdpUrl.
   * Chromium only accepts the debugging flag at startup, so without this the
   * user has to run a flag-laden command by hand.
   */
  autoLaunch: boolean;
  /** Full path to a Chrome/Chromium binary. Auto-detected when empty. */
  binary: string;
  /** Persistent profile for the automated window — the user logs in once. */
  profileDir: string;
  headless: boolean;
  /** Meter threshold: past this many chars, roll the thread to a new chat. */
  threadBudgetChars: number;
  /** Browser mode truncates tool results far harder than API mode. */
  maxToolResultChars: number;
  /** Escalating protocol-repair attempts before the turn fails. */
  maxRepairAttempts: number;
  /** Max concurrent live tabs. Beyond this, thread requests queue. */
  threadPoolSize: number;
  /** Ledger entries expire after this much thread growth since they were sent. */
  ledgerMaxAgeChars: number;
  /** "inherit", or an API provider id to keep subagents off browser tabs. */
  subagentProvider: string;
}
