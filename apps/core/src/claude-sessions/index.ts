// =============================================================================
// Claude Code session discovery — barrel.
//
// Re-exports the scanner + transcript parser and a small façade that the
// server-side handlers call. Keep this thin so the handlers don't reach
// into scanner internals.
// =============================================================================

export {
  getClaudeConfigDir,
  listClaudeSessions,
  readClaudeTranscript,
  extractTitleFromJsonl,
  decodeProjectSlug,
  type ClaudeListOptions,
  type ClaudeTranscriptOptions,
} from "./scanner.js";
