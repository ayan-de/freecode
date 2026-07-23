// Applies compaction so it persists across turns: MemoryService produces the
// summary (kept in the system prompt), and the session store is trimmed to the
// preserved recent turns so the NEXT turn's loadHistory() sends fewer messages.

import type { SessionStore, SerializedMessage } from "./store.js";
import type { MemoryService } from "../compaction/service.js";
import type { CompactOptions } from "../compaction/service.js";
import { DEFAULT_COMPACTION_CONFIG } from "../compaction/types.js";

export interface ApplyCompactionResult {
  compacted: boolean;
  reason?: string;
  tokensBefore: number;
  tokensAfter: number;
  messagesBefore: number;
  messagesAfter: number;
}

/**
 * Keep the last `n` user turns (and everything after the earliest of them).
 * The result still starts on a user message, so it stays a valid conversation.
 */
export function keepLastNUserTurns(
  messages: SerializedMessage[],
  n: number,
): SerializedMessage[] {
  if (n <= 0) return [];
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      seen++;
      if (seen === n) return messages.slice(i);
    }
  }
  return messages.slice(); // fewer than n user turns → keep everything
}

export async function applyCompaction(opts: {
  memory: MemoryService;
  store: SessionStore;
  sessionId: string;
  projectPath: string;
  preserveRecentTurns?: number;
  compactOptions?: CompactOptions;
}): Promise<ApplyCompactionResult> {
  const preserveRecentTurns =
    opts.preserveRecentTurns ?? DEFAULT_COMPACTION_CONFIG.preserveRecentTurns;

  const result = await opts.memory.compact(opts.compactOptions);
  if (!result.success || !result.summary) {
    return {
      compacted: false,
      reason: result.blocked ? result.reason : "nothing to compact",
      tokensBefore: result.tokenCountBefore,
      tokensAfter: result.tokenCountAfter,
      messagesBefore: 0,
      messagesAfter: 0,
    };
  }

  const stored = await opts.store.getMessages(opts.sessionId, opts.projectPath);
  const preserve = keepLastNUserTurns(stored, preserveRecentTurns);
  if (preserve.length < stored.length) {
    await opts.store.replaceMessages(
      opts.sessionId,
      preserve,
      opts.projectPath,
    );
  }

  return {
    compacted: true,
    tokensBefore: result.tokenCountBefore,
    tokensAfter: result.tokenCountAfter,
    messagesBefore: stored.length,
    messagesAfter: preserve.length,
  };
}
