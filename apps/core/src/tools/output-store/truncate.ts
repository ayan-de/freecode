// =============================================================================
// adaptiveTruncate - head+tail bookend truncation (spec D2). Replaces the old
// head-only capModelOutput: build errors, stack traces and summaries usually
// live at the END of output, so keeping only the head threw away exactly what
// the model most needs. The marker names the toolCallId + the `output` retrieval
// handle so the model can page the rest instead of re-running the tool.
// =============================================================================

// Budget split into a head and a smaller tail (see config.ts for the knobs).
// ponytail: char cap, not token-aware — matches the old 30 KB behaviour.
import { MAX_MODEL_OUTPUT_CHARS, HEAD_CHARS, TAIL_CHARS } from "./config.js";

export function adaptiveTruncate(
  output: string,
  toolCallId: string,
): { modelOutput: string; truncated: boolean } {
  if (output.length <= MAX_MODEL_OUTPUT_CHARS) {
    return { modelOutput: output, truncated: false };
  }
  // Snap both cuts to line boundaries. A raw character index lands mid-line and
  // mid-token, so the model reads a half-identifier as though it were whole —
  // and grep/build output is line-structured, which the marker then breaks.
  // Falls back to the exact index when a line spans the whole budget.
  const headEnd = output.lastIndexOf("\n", HEAD_CHARS);
  const head = output.slice(0, headEnd > 0 ? headEnd : HEAD_CHARS);
  const tailStart = output.indexOf("\n", output.length - TAIL_CHARS);
  const tail = output.slice(
    tailStart >= 0 ? tailStart + 1 : output.length - TAIL_CHARS,
  );
  const marker =
    `\n\n... [truncated ${output.length} chars total — ` +
    `use the \`output\` tool with id="${toolCallId}" (offset, limit, or pattern) ` +
    `to read the omitted middle] ...\n\n`;
  return { modelOutput: `${head}${marker}${tail}`, truncated: true };
}
