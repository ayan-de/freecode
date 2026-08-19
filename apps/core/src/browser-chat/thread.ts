// =============================================================================
// Browser Chat — sent log and divergence classification
//
// The site holds the thread and WE CANNOT RETRACT FROM IT. So we diff incoming
// messages against what this thread has actually received — never against the
// local history's own prefix. Compaction drops old messages locally while the
// site still has them; treating that as divergence would pay for a rebootstrap,
// the most expensive operation here, in exchange for nothing.
//
// Verified in Phase 2: Message.id survives persistence (session/store.ts:352),
// and compaction is a suffix-preserving trim that keeps ids intact
// (session/compact-apply.ts).
// =============================================================================

import { createHash } from "crypto";
import type { Message } from "../agent/types.js";

export type Divergence =
  /** Normal turn: these messages are new and go on the wire. */
  | { kind: "append"; newMessages: Message[] }
  /** Nothing sent yet — bootstrap this thread. */
  | { kind: "fresh" }
  /** A message we already sent has changed, or order broke. Rebootstrap. */
  | { kind: "contradiction"; reason: string };

/**
 * Synthetic messages the loop rebuilds every turn under a FIXED id: the
 * dynamic project context carries the file tree, git head and a clock, so its
 * content changes on every request while its id stays `dynamic-context`
 * (agent/loop.ts:1672).
 *
 * Without this exemption the classifier would read that as "a message we
 * already sent has been edited" and rebootstrap on EVERY turn — turning the
 * most expensive operation in browser mode into the default path. Volatile
 * messages are never recorded and never compared; the browser provider sends
 * a small delta for them instead.
 */
export const VOLATILE_MESSAGE_IDS = new Set(["dynamic-context"]);

function hashMessage(message: Message): string {
  return createHash("sha256")
    .update(JSON.stringify({ role: message.role, parts: message.parts }))
    .digest("hex")
    .slice(0, 16);
}

export class SentLog {
  private hashes = new Map<string, string>();

  get size(): number {
    return this.hashes.size;
  }

  classify(messages: Message[]): Divergence {
    if (this.hashes.size === 0) return { kind: "fresh" };

    let seenUnknown = false;
    const newMessages: Message[] = [];

    for (const message of messages) {
      if (VOLATILE_MESSAGE_IDS.has(message.id)) continue;
      const known = this.hashes.get(message.id);
      if (known === undefined) {
        seenUnknown = true;
        newMessages.push(message);
        continue;
      }
      // A known id appearing AFTER an unknown one means something was
      // inserted mid-history rather than appended. The thread cannot be
      // patched to match that.
      if (seenUnknown) {
        return {
          kind: "contradiction",
          reason: `message ${message.id} appears after new messages`,
        };
      }
      if (known !== hashMessage(message)) {
        return {
          kind: "contradiction",
          reason: `message ${message.id} was edited after we sent it`,
        };
      }
    }

    // Every id is unknown while the log is non-empty ⇒ a different session.
    if (newMessages.length > 0 && newMessages.length === this.countStable(messages)) {
      return { kind: "contradiction", reason: "no overlap with this thread" };
    }

    // Note what is NOT here: a check that previously-sent ids are still
    // present. Compaction drops them locally, the site keeps them, and that
    // is fine.
    return { kind: "append", newMessages };
  }

  private countStable(messages: Message[]): number {
    return messages.filter((m) => !VOLATILE_MESSAGE_IDS.has(m.id)).length;
  }

  /** Record messages as accounted for on this thread. */
  commit(messages: Message[]): void {
    for (const message of messages) {
      if (VOLATILE_MESSAGE_IDS.has(message.id)) continue;
      this.hashes.set(message.id, hashMessage(message));
    }
  }

  /** Rebootstrap: the old thread is gone, so its history is meaningless. */
  reset(): void {
    this.hashes.clear();
  }
}
