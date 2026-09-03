// =============================================================================
// Content-aware output compression — spec 2026-09-04-harness-cost-efficiency.md
// D2. Classification happens in bash (the tool knows what was run); compression
// happens in the orchestrator (the cap site — D1's rule that every lossy cap
// runs after the OutputStore put, where the toolCallId is known for markers).
//
// Off by default: FREECODE_BASH_COMPRESS=1 enables, read per call so `eval ab`
// can flip it per variant. The default is earned by the A/B, not asserted here.
//
// Conservative by design (Copilot's finding: aggressive compression makes the
// agent re-run commands, which costs more end-to-end than it saves):
//   source — never touched. The model asked for bytes; it gets bytes.
//   search — only consecutive duplicate lines collapse; a match never drops.
//   log    — progress noise and duplicates collapse; head, tail and every
//            failure-looking line survive; elisions name the retrieval handle.
//   other  — never touched.
// =============================================================================

import { MAX_MODEL_OUTPUT_CHARS } from "./output-store/config.js";

export type OutputKind = "source" | "search" | "log" | "other";

const SOURCE_RE = /^(cat|head|tail|sed\s+-n|git\s+(diff|show))\b/;
const SEARCH_RE = /^(grep|rg|ag|find|fd)\b/;
const LOG_RE =
  /^(npm|pnpm|yarn|bun)\s+(ci|i|install|add|run|test|exec)\b|^(cargo|go|make|mvn|gradle|pip3?|pytest|vitest|jest|tsc|docker)\b/;

/** Lines that must survive log compression whatever else goes. */
const FAILURE_RE =
  /\b(error|err!|fail|failed|failure|fatal|exception|traceback|panic|not ok)\b|✗|✖/i;

/** Kept verbatim at each end of a compressed log, in lines. */
const LOG_HEAD_LINES = 40;
const LOG_TAIL_LINES = 60;

/**
 * Classify by what will come OUT of the command: the last segment of a
 * pipeline names the shape of the output (`npm test | grep FAIL` emits search
 * results, not a build log). A pipe inside quoting would make that split
 * wrong, so a command mixing quotes and pipes is left unclassified.
 */
export function classifyCommand(command: string): OutputKind {
  const cmd = command.trim();
  let last = cmd;
  if (cmd.includes("|")) {
    if (/["'`]/.test(cmd)) return "other";
    const segments = cmd.split("|");
    last = segments[segments.length - 1].trim();
  }
  if (SEARCH_RE.test(last)) return "search";
  if (SOURCE_RE.test(last)) return "source";
  if (LOG_RE.test(cmd)) return "log";
  return "other";
}

/** `n` consecutive copies of a line become one copy plus a count. */
function collapseRuns(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    out.push(lines[i]);
    if (j - i > 2) out.push(`  [previous line repeated ${j - i - 1} more times]`);
    else for (let k = i + 1; k < j; k++) out.push(lines[k]);
    i = j;
  }
  return out;
}

function compressSearch(output: string): string {
  return collapseRuns(output.split("\n")).join("\n");
}

function compressLog(output: string, toolCallId: string): string {
  const lines = collapseRuns(output.split("\n"));
  if (lines.length <= LOG_HEAD_LINES + LOG_TAIL_LINES) return lines.join("\n");

  const tailStart = lines.length - LOG_TAIL_LINES;
  const keep = (i: number) =>
    i < LOG_HEAD_LINES || i >= tailStart || FAILURE_RE.test(lines[i]);

  const out: string[] = [];
  let omitted = 0;
  const flush = () => {
    if (omitted > 0) {
      out.push(
        `[... ${omitted} lines omitted — full output via the \`output\` tool, id="${toolCallId}" ...]`,
      );
      omitted = 0;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    if (keep(i)) {
      flush();
      out.push(lines[i]);
    } else {
      omitted++;
    }
  }
  flush();
  return out.join("\n");
}

/**
 * The orchestrator's entry point. Returns the model-facing view; the caller
 * has already stored the full text. Compression only engages past the size
 * threshold — below it the model sees everything anyway, so compressing
 * would lose information for zero benefit — and only when it actually helps.
 */
export function maybeCompressOutput(
  output: string,
  kind: unknown,
  toolCallId: string,
): string {
  if (process.env.FREECODE_BASH_COMPRESS !== "1") return output;
  if (output.length <= MAX_MODEL_OUTPUT_CHARS) return output;
  let compressed: string;
  if (kind === "search") compressed = compressSearch(output);
  else if (kind === "log") compressed = compressLog(output, toolCallId);
  else return output;
  return compressed.length < output.length ? compressed : output;
}
