// =============================================================================
// adaptiveTruncate - head+tail bookend truncation (spec D2). Replaces the old
// head-only capModelOutput: build errors, stack traces and summaries usually
// live at the END of output, so keeping only the head threw away exactly what
// the model most needs. The marker names the toolCallId + the `output` retrieval
// handle so the model can page the rest instead of re-running the tool.
// =============================================================================

// Total budget sent to the model; split into a head and a smaller tail.
// ponytail: char cap, not token-aware — matches the old 30 KB behaviour.
const MAX_MODEL_OUTPUT_CHARS = 30_000;
const TAIL_CHARS = 6_000;
const HEAD_CHARS = MAX_MODEL_OUTPUT_CHARS - TAIL_CHARS; // 24 KB

export function adaptiveTruncate(
  output: string,
  toolCallId: string,
): { modelOutput: string; truncated: boolean } {
  if (output.length <= MAX_MODEL_OUTPUT_CHARS) {
    return { modelOutput: output, truncated: false };
  }
  const head = output.slice(0, HEAD_CHARS);
  const tail = output.slice(output.length - TAIL_CHARS);
  const marker =
    `\n\n... [truncated ${output.length} chars total — ` +
    `use the \`output\` tool with id="${toolCallId}" (offset, limit, or pattern) ` +
    `to read the omitted middle] ...\n\n`;
  return { modelOutput: `${head}${marker}${tail}`, truncated: true };
}
