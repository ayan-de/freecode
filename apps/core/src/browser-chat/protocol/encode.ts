// =============================================================================
// Browser Chat — outgoing text
//
// Renders the system prompt, tool definitions and messages into what we type
// into the composer. The bootstrap is the expensive message (it carries
// everything); every later turn is a delta, because the site holds the thread.
// =============================================================================

import type { Message } from "../../agent/types.js";
import type { ToolDef } from "../../providers/types.js";
import { ledgerKey, type SentLedger } from "../cache/ledger.js";
import { VOLATILE_MESSAGE_IDS } from "../thread.js";

/** Supplied on delta turns so repeated identical reads are not re-sent. */
export interface LedgerContext {
  ledger: SentLedger;
  charsNow: number;
  turn: number;
}

export const FENCE = "~~~freecode";
export const RESULT_FENCE = "~~~freecode-result";

/**
 * Deliberately blunt. The UI model is tuned to be conversational, and the
 * bootstrap is the only place we get to counter that.
 */
export function protocolContract(): string {
  return [
    "## Output protocol (read carefully)",
    "",
    "A program parses your replies. It is not a person.",
    "",
    "To use a tool, reply with exactly one block and nothing else:",
    "",
    FENCE,
    '{"calls":[{"id":"1","name":"read","args":{"path":"src/a.ts"}}]}',
    "~~~",
    "",
    "Rules:",
    "- `args` values are JSON. Escape newlines and quotes.",
    "- Request several tools in one block when you can: each block costs a full",
    "  round trip, so batching is much faster than one call at a time.",
    "- Do not add commentary around the block. It is discarded.",
    "- When you are done and want to answer the user, reply with plain prose and",
    "  no block. That ends the turn.",
    "",
    "Tool results come back as:",
    "",
    RESULT_FENCE,
    '{"1":"...result text..."}',
    "~~~",
  ].join("\n");
}

export function renderTools(tools: ToolDef[]): string {
  if (tools.length === 0) return "";
  const lines = ["## Available tools", ""];
  for (const tool of tools) {
    lines.push(`### ${tool.name}`);
    lines.push(tool.description);
    lines.push("Parameters (JSON Schema):");
    lines.push("```json");
    lines.push(JSON.stringify(tool.parameters));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const kept = text.slice(0, maxChars);
  const droppedLines = text.slice(maxChars).split("\n").length;
  return `${kept}\n… [truncated: ${droppedLines} more lines. Ask again with an offset to see more.]`;
}

/**
 * One outgoing turn. Assistant messages are skipped: the site produced them and
 * they are already in its thread — re-sending would duplicate them.
 */
export function renderOutgoing(
  messages: Message[],
  maxToolResultChars: number,
  ledgerContext?: LedgerContext,
): string {
  const results: Record<string, string> = {};
  const prose: string[] = [];

  for (const message of messages) {
    if (message.role === "assistant") continue;
    // The project context is handled as a delta by the provider, not resent.
    if (VOLATILE_MESSAGE_IDS.has(message.id)) continue;
    for (const part of message.parts) {
      if (part.type === "text") {
        prose.push(part.content);
      } else if (part.type === "code") {
        prose.push("```" + part.language + "\n" + part.content + "\n```");
      } else if (part.type === "tool" && part.result !== undefined) {
        // Truncate FIRST: the ledger must hash what the model actually
        // receives, not what was read from disk.
        const payload = truncate(part.result, maxToolResultChars);
        const key = ledgerContext
          ? ledgerKey(part.tool.tool, part.tool.args)
          : null;
        if (key && ledgerContext) {
          const decision = ledgerContext.ledger.consider(
            key,
            payload,
            ledgerContext.charsNow,
            ledgerContext.turn,
          );
          if (decision.dedupe) {
            results[part.tool.id] = decision.replacement;
            continue;
          }
          ledgerContext.ledger.record(
            key,
            payload,
            ledgerContext.charsNow,
            ledgerContext.turn,
          );
        }
        results[part.tool.id] = payload;
      }
    }
  }

  const blocks: string[] = [];
  if (Object.keys(results).length > 0) {
    blocks.push(
      [RESULT_FENCE, JSON.stringify(results), "~~~"].join("\n"),
    );
  }
  if (prose.length > 0) blocks.push(prose.join("\n\n"));
  return blocks.join("\n\n");
}

export function buildBootstrap(opts: {
  system: string;
  tools: ToolDef[];
  messages: Message[];
  maxToolResultChars: number;
}): string {
  return [
    opts.system,
    "",
    renderTools(opts.tools),
    protocolContract(),
    "",
    "---",
    "",
    renderOutgoing(opts.messages, opts.maxToolResultChars),
  ]
    .filter((section) => section.length > 0)
    .join("\n");
}
