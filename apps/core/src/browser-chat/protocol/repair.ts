// =============================================================================
// Browser Chat — protocol repair
//
// Escalating, not repetitive: resending the same terse nudge to a model that
// already ignored it is a wasted turn. Fires ONLY when no parseable block
// exists — a correct block in the wrong fence is handled by the lenient parser
// at zero cost.
// =============================================================================

import type { ProtocolViolation } from "./parse.js";
import { protocolContract } from "./encode.js";

/**
 * @param attempt 1-based. Returns null when the budget is spent.
 */
export function buildRepairMessage(
  attempt: number,
  violation: ProtocolViolation,
  maxAttempts: number,
): string | null {
  if (attempt > maxAttempts) return null;

  const why =
    violation === "bad-json"
      ? "the JSON in your block did not parse"
      : "your block was not shaped like {\"calls\":[{\"name\":…,\"args\":{…}}]}";

  if (attempt === 1) {
    return (
      `Protocol error: ${why}. Resend exactly one ~~~freecode block and ` +
      `nothing else. If you did not mean to call a tool, reply with plain ` +
      `prose and no block.`
    );
  }

  // Later attempts restate the whole contract — a mini re-bootstrap of the
  // format rules, since the terse version demonstrably did not land.
  return [
    `Protocol error again: ${why}.`,
    "",
    protocolContract(),
    "",
    "Reply now with either one valid block or plain prose.",
  ].join("\n");
}
