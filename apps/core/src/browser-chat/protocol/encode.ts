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
 * Frames this as a REQUEST FROM A PROGRAM, never as a claim about who the
 * model is.
 *
 * The first live run failed here. Told it was "FreeCode, an AI coding
 * assistant CLI" with a bash/edit/glob toolset, the model correctly replied
 * that it is Claude in the claude.ai interface and has no such tools — it
 * rejected the premise rather than the format. Repair cannot fix that: it
 * would restate a premise the model has already, reasonably, disputed.
 *
 * So nothing here asserts an identity or claims the model owns the tools. The
 * tools belong to us; we are offering to run them on its behalf.
 *
 * The second live run then failed differently: the model accepted the framing
 * but reached for claude.ai's OWN sandbox tools, searched a container that does
 * not contain the project, and reported the file missing. Hence the explicit
 * "your sandbox is a different computer" section — without it, using its own
 * tools is the more natural reading of "read package.json".
 */
export function protocolContract(): string {
  return [
    "# Who you are talking to",
    "",
    "You are talking to a program, not a person. I am FreeCode, a command-line",
    "tool running on a developer's computer. I pass your replies to their",
    "terminal, and I can run commands on that machine for you.",
    "",
    "You do not have these tools yourself, and I am not asking you to pretend",
    "otherwise — **I** have them. Tell me which one to run and I will run it and",
    "paste the real output back to you in my next message.",
    "",
    "## Your own sandbox is a different computer",
    "",
    "You may also have code execution or file tools built into this interface.",
    "Those run in a sandbox somewhere else. **The developer's project does not",
    "exist there.** Searching that sandbox for their files will find nothing,",
    "or worse, will find unrelated files with the same names.",
    "",
    "Please do not use those tools for this task. The only way to reach the",
    "developer's actual machine is to ask me, using the block below.",
    "",
    "## Asking me to run something",
    "",
    "Reply with exactly one block and nothing else:",
    "",
    FENCE,
    '{"calls":[{"id":"1","name":"read","args":{"path":"src/a.ts"}}]}',
    "~~~",
    "",
    "I will reply with the real output:",
    "",
    RESULT_FENCE,
    '{"1":"...actual file contents..."}',
    "~~~",
    "",
    "## Rules",
    "",
    "- `args` values are JSON. Escape newlines and quotes.",
    "- Ask for several things in one block when you can. Every block is a full",
    "  round trip, so batching is much faster than one at a time.",
    "- I read your reply mechanically, so prose outside the block is discarded.",
    "- When you have what you need and want to answer the developer, reply in",
    "  plain prose with no block. That ends the exchange.",
  ].join("\n");
}

/**
 * The system prompt is written for an API model and addresses the reader as
 * "You are FreeCode". Pasted raw into a chat UI it reads as an identity claim,
 * which is exactly what got rejected. Labelling it defuses the conflict
 * instead of hoping the model does not notice — it noticed immediately.
 */
function systemSection(system: string): string {
  if (system.length === 0) return "";
  return [
    "## How I am configured",
    "",
    "The text below is my own configuration. It is written in the second person",
    'and calls the reader "FreeCode" — that describes this program and how it',
    "works. It is not a claim about who you are. Read it as background on what",
    "I will do with your answers.",
    "",
    system,
  ].join("\n");
}

export function renderTools(tools: ToolDef[]): string {
  if (tools.length === 0) return "";
  // "What I can run for you", not "your tools": the phrasing is load-bearing.
  const lines = ["## What I can run for you", ""];
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
  // Order is deliberate: establish the relay framing FIRST, so everything
  // after it — including a system prompt written in the second person — is
  // read inside that frame rather than as a competing identity claim.
  return [
    protocolContract(),
    "",
    renderTools(opts.tools),
    systemSection(opts.system),
    "",
    "---",
    "",
    "## What the developer asked for",
    "",
    renderOutgoing(opts.messages, opts.maxToolResultChars),
  ]
    .filter((section) => section.length > 0)
    .join("\n");
}
