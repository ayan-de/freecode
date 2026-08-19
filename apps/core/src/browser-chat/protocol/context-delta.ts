// =============================================================================
// Browser Chat — project context delta
//
// The file tree ships once, in the bootstrap. Re-sending it every turn (which
// is what API mode does deliberately, for prompt-cache reasons that do not
// apply here — agent/loop.ts:1672) would spend thread budget restating
// something the model can already scroll up and read.
//
// So later turns send only what changed.
// =============================================================================

import type { Message } from "../../agent/types.js";
import { VOLATILE_MESSAGE_IDS } from "../thread.js";

/**
 * Lines that change every turn on their own. The dynamic context embeds a
 * clock, so without this every single turn would report a "change" and the
 * delta would never be empty.
 */
const VOLATILE_LINE = /\d{1,2}:\d{2}/;

const MAX_DELTA_LINES = 40;

function meaningfulLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !VOLATILE_LINE.test(line));
}

/** The synthetic context message the loop prepends, if present. */
export function extractProjectContext(messages: Message[]): string | null {
  const message = messages.find((m) => VOLATILE_MESSAGE_IDS.has(m.id));
  if (!message) return null;
  return message.parts
    .filter((part): part is { type: "text"; content: string } => part.type === "text")
    .map((part) => part.content)
    .join("\n");
}

/**
 * Returns a compact note, or null when nothing worth reporting changed.
 * Null is the common case and means we send nothing at all.
 */
export function diffProjectContext(
  previous: string,
  current: string,
): string | null {
  const before = new Set(meaningfulLines(previous));
  const after = meaningfulLines(current);
  const afterSet = new Set(after);

  const added = after.filter((line) => !before.has(line));
  const removed = [...before].filter((line) => !afterSet.has(line));
  if (added.length === 0 && removed.length === 0) return null;

  const lines = ["Project context changed since the last message:"];
  for (const line of added.slice(0, MAX_DELTA_LINES)) lines.push(`+ ${line}`);
  for (const line of removed.slice(0, MAX_DELTA_LINES)) lines.push(`- ${line}`);
  const overflow =
    Math.max(0, added.length - MAX_DELTA_LINES) +
    Math.max(0, removed.length - MAX_DELTA_LINES);
  if (overflow > 0) lines.push(`… and ${overflow} more changes`);
  return lines.join("\n");
}
