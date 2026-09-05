// =============================================================================
// Gemini web session — experimental text-protocol tool bridge
//
// The web endpoint has no tools field: the only channel is one prompt string
// in, one markdown reply out. This module teaches the model a tool-call wire
// format IN TEXT, parses it back out of the reply, and lets the provider emit
// real `tool_call` chunks that the agent loop executes like any other
// provider's. The loop, orchestrator, permission modes and batching are all
// unchanged — the bridge only adapts the channel.
//
// Why this can work where E1 failed (spec §4): E1 measured the model silently
// answering from priors on 44% of turns. The bridge attacks that structurally,
// not by hoping the model behaves:
//
//   1. Every reply must be EITHER a [TOOL_CALLS] block OR begin with `FINAL:`.
//      A fluent answer that is neither is a detectable protocol violation, not
//      a silent fabrication — the provider re-prompts once with a correction.
//   2. Streaming is gated: nothing is shown to the user until the reply is
//      classified, so a violating reply can be retried without having already
//      printed a fabrication on screen.
//   3. What cannot be forced to 0% is the model emitting a *compliant* FINAL
//      answer it invented. The prompt's grounding rules and @mention inlining
//      (still active) shrink that residue; they cannot eliminate it. That is
//      why this stays opt-in (`experimentalTools`) and off by default — D1
//      still stands as the measured default.
//
// The block format is deliberately the same one the agent loop already parses
// as a fallback (`[TOOL_CALLS]\nname:{json}\n[/TOOL_CALLS]`, loop.ts
// normalizeResponse), so even a reply that slips past this parser intact can
// still be picked up downstream.
// =============================================================================

import type { ToolDef } from "../types.js";

export interface BridgeToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ParsedReply {
  /** Text outside the tool block, `FINAL:` token stripped. */
  content: string;
  toolCalls: BridgeToolCall[];
  /** Set when the reply satisfied neither arm of the protocol — the caller
   *  should re-prompt once with this reason. Undefined means compliant. */
  violation?: string;
}

const BLOCK = /\[TOOL_CALLS\]([\s\S]*?)\[\/TOOL_CALLS\]/g;
const OPEN_MARKER = "[TOOL_CALLS]";
const FINAL_TOKEN = "FINAL:";
// `name:{json}` — the same line shape the loop's fallback parser accepts.
const CALL_LINE = /^([\w-]+)\s*:\s*(\{[\s\S]*\})\s*$/;

let counter = 0;
const callId = () => `gw-${Date.now()}-${counter++}`;

/** One-line signature per tool. The full JSON schemas would cost tens of KB
 *  against a ~60 KB payload ceiling that is re-paid every turn; a name, the
 *  parameter names (required ones bare, optional ones suffixed `?`) and the
 *  first sentence of the description carry what the model needs. */
function toolLine(tool: ToolDef): string {
  const props =
    (tool.parameters?.properties as Record<string, unknown> | undefined) ?? {};
  const required = new Set(
    Array.isArray(tool.parameters?.required)
      ? (tool.parameters.required as string[])
      : [],
  );
  const params = Object.keys(props)
    .map((name) => (required.has(name) ? name : `${name}?`))
    .join(", ");
  const description = tool.description.split(/\.\s|\n/)[0].slice(0, 200);
  return `- ${tool.name}(${params}): ${description}`;
}

/** The protocol block appended to the system prompt when tools are enabled. */
export function buildToolProtocol(tools: ToolDef[]): string {
  return [
    "You are operating a software project through tools. You CANNOT see files,",
    "directories, or command output yourself — the only way to observe or",
    "change anything is to request a tool and wait for its result.",
    "",
    "Available tools:",
    ...tools.map(toolLine),
    "",
    "PROTOCOL — every reply must be exactly one of these two forms:",
    "",
    "1. A tool request. Emit this block, one `name:{JSON args}` per line, and",
    "   write NOTHING after the closing marker:",
    "[TOOL_CALLS]",
    'read:{"filePath":"src/example.ts"}',
    "[/TOOL_CALLS]",
    "",
    "2. A final answer, beginning with the token FINAL: — allowed only when",
    "   every fact you state is grounded in tool results or file contents",
    "   already present in this conversation.",
    "",
    "HARD RULES:",
    "- NEVER state or quote file contents, line numbers, command output, or",
    "  project facts you have not observed in this conversation. If you have",
    "  not read it, read it first.",
    "- If you are about to describe what a file 'probably' contains, stop and",
    "  emit a tool request instead.",
    "- Only the tools listed above exist. Args are a single JSON object.",
    "- A reply that is neither a [TOOL_CALLS] block nor a FINAL: answer is a",
    "  protocol error and will be rejected.",
  ].join("\n");
}

/** Fence lines the model may wrap the block in (`\`\`\``) are noise. */
const isFence = (line: string) => /^\s*```/.test(line.trim());

/** Parse one reply into content + tool calls, flagging protocol violations. */
export function parseReply(text: string): ParsedReply {
  const toolCalls: BridgeToolCall[] = [];
  const badLines: string[] = [];
  let outside = "";
  let last = 0;

  BLOCK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BLOCK.exec(text)) !== null) {
    outside += text.slice(last, match.index);
    last = BLOCK.lastIndex;
    for (const raw of match[1].split("\n")) {
      const line = raw.trim();
      if (!line || isFence(line)) continue;
      const call = line.match(CALL_LINE);
      if (!call) {
        badLines.push(`not name:{json}: "${line.slice(0, 80)}"`);
        continue;
      }
      try {
        toolCalls.push({
          id: callId(),
          name: call[1],
          args: JSON.parse(call[2]) as Record<string, unknown>,
        });
      } catch (error) {
        badLines.push(`args are not valid JSON (${String(error)}): "${line.slice(0, 80)}"`);
      }
    }
  }
  outside += text.slice(last);

  let content = outside.trim();
  const hadFinal = content.startsWith(FINAL_TOKEN);
  if (hadFinal) content = content.slice(FINAL_TOKEN.length).trim();

  if (toolCalls.length > 0) return { content, toolCalls };
  if (badLines.length > 0) {
    return {
      content,
      toolCalls,
      violation: `the [TOOL_CALLS] block had unparseable lines — ${badLines.join("; ")}`,
    };
  }
  if (hadFinal) return { content, toolCalls };
  return {
    content,
    toolCalls,
    violation:
      "the reply was neither a [TOOL_CALLS] block nor an answer beginning with FINAL:",
  };
}

/** Longest suffix of `text` that is a prefix of `marker` — held back so a
 *  marker split across two deltas is never half-shown. */
function partialMarkerSuffix(text: string, marker: string): number {
  const max = Math.min(text.length, marker.length - 1);
  for (let n = max; n > 0; n--) {
    if (text.endsWith(marker.slice(0, n))) return n;
  }
  return 0;
}

export type GateMode = "pending" | "final" | "tool" | "violation";

/**
 * Withholds streamed text until the reply is classified.
 *
 * The whole point of the FINAL:/[TOOL_CALLS] dichotomy is that a violating
 * reply can be retried — but only if nothing has been printed yet. So:
 *
 * - `FINAL:` at the start → final mode; text streams live (token stripped),
 *   with any later [TOOL_CALLS] marker and everything after it withheld.
 * - `[TOOL_CALLS]` anywhere → tool mode; text before the marker is emitted
 *   (a short note before the block is tolerated), the block itself never
 *   streams as text.
 * - Anything else stays buffered. If the stream ends still unclassified,
 *   nothing was emitted and the caller is free to re-prompt.
 */
export class StreamGate {
  private buffer = "";
  private held = "";
  private full_ = "";
  private mode_: GateMode = "pending";
  private emitted_ = false;

  get mode(): GateMode {
    return this.mode_;
  }

  /** The entire reply seen so far, unfiltered — what parseReply gets. */
  get full(): string {
    return this.full_;
  }

  /** Whether any text has been released to the caller. */
  get emitted(): boolean {
    return this.emitted_;
  }

  push(delta: string): string {
    this.full_ += delta;
    if (this.mode_ === "tool") return "";
    if (this.mode_ === "final") return this.release(delta);

    // pending: classify on the accumulated text
    this.buffer += delta;
    const trimmed = this.buffer.trimStart();

    const markerAt = this.buffer.indexOf(OPEN_MARKER);
    if (markerAt !== -1) {
      this.mode_ = "tool";
      const before = this.buffer.slice(0, markerAt).trim();
      this.buffer = "";
      if (before) this.emitted_ = true;
      return before ? `${before}\n` : "";
    }
    if (trimmed.startsWith(FINAL_TOKEN)) {
      this.mode_ = "final";
      const rest = trimmed.slice(FINAL_TOKEN.length).replace(/^[ \t]+/, "");
      this.buffer = "";
      return this.release(rest);
    }
    // Could this still become one of the two forms? FINAL: must open the
    // reply; the block marker may appear later, so text is held either way.
    return "";
  }

  /** Flush at end of stream. Returns any withheld text that is safe to show. */
  finish(): string {
    if (this.mode_ === "final") {
      const tail = this.held;
      this.held = "";
      if (tail) this.emitted_ = true;
      return tail;
    }
    if (this.mode_ === "pending") this.mode_ = "violation";
    return "";
  }

  private release(text: string): string {
    let pending = this.held + text;
    this.held = "";
    const markerAt = pending.indexOf(OPEN_MARKER);
    if (markerAt !== -1) {
      // Final answer that grew a tool block anyway: emit up to the marker,
      // swallow the rest — parseReply picks the calls up from `full`.
      this.mode_ = "tool";
      pending = pending.slice(0, markerAt);
    } else {
      const partial = partialMarkerSuffix(pending, OPEN_MARKER);
      if (partial > 0) {
        this.held = pending.slice(pending.length - partial);
        pending = pending.slice(0, pending.length - partial);
      }
    }
    if (pending) this.emitted_ = true;
    return pending;
  }
}

/** The corrective re-prompt appended after a violating reply. Sent once; a
 *  second violation is surfaced to the user rather than looped on — every
 *  retry is a full request against the session's quota (spec E3). */
export function correctionPrompt(violatingReply: string, reason: string): string {
  return [
    `[Assistant]: ${violatingReply}`,
    "",
    `[System instruction]: Your previous reply violated the protocol: ${reason}.`,
    "Reply again now, following the protocol exactly: either request tools",
    "with a [TOOL_CALLS] block, or give the final answer beginning with FINAL:.",
  ].join("\n");
}
