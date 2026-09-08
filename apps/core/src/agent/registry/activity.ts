// =============================================================================
// Stream event -> one line of a subagent's activity log.
//
// A subagent's AgentLoop publishes ordinary StreamEvents under its OWN session
// id, which no frontend is subscribed to — so without this they are emitted and
// dropped. The registry folds them into a ring buffer instead, which is what
// the /agents panel tails.
//
// This is a summary, not a transcript: tool calls and assistant text only.
// Reasoning is omitted deliberately (it is the bulk of the bytes and the least
// useful thing to watch scroll past), and `text` / `done` are skipped because
// the deltas already carried the same characters.
// =============================================================================

import type { StreamEvent } from "@thisisayande/freecode-shared";

/** Longest argument summary rendered beside a tool name. */
const ARG_CHARS = 60;

/**
 * The one argument worth showing per tool, in the order we would guess it.
 * A tool with none of these renders bare — better than dumping a JSON blob
 * into a five-row viewport.
 */
const ARG_KEYS = [
  "command",
  "file_path",
  "path",
  "pattern",
  "query",
  "url",
  "task",
  "description",
];

function summarizeArgs(args: Record<string, unknown>): string {
  for (const key of ARG_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) {
      const line = value.split("\n")[0];
      return line.length > ARG_CHARS ? `${line.slice(0, ARG_CHARS)}…` : line;
    }
  }
  return "";
}

/**
 * Returns the text to append for this event, or undefined to ignore it.
 * Returned text is appended verbatim, so callers own their own newlines.
 */
export function formatActivity(event: StreamEvent): string | undefined {
  switch (event.type) {
    case "tool_start": {
      const arg = summarizeArgs(event.args ?? {});
      return `\n> ${event.toolName}${arg ? `(${arg})` : ""}\n`;
    }
    case "tool_complete":
      return event.success ? undefined : `  ! ${event.toolName} failed\n`;
    case "text_delta":
      return event.delta;
    case "error":
      return `\n! ${event.content}\n`;
    default:
      // thinking/thinking_delta/text/done/tool_output and every panel event:
      // either noise, or characters the deltas already delivered.
      return undefined;
  }
}
