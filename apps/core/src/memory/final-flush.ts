// =============================================================================
// End-of-session extraction flush (spec D4).
//
// The write path's interval gate (`extractEveryNRuns`, default 8) means a
// session that ends at run 5 mines nothing — so "user states a preference in a
// one-shot session and it is lost" was the documented behaviour, not an edge
// case. This runs one last extraction when a session actually ends.
//
// It rebuilds the transcript from the session store rather than from a live
// AgentLoop, because there usually isn't one: `activeLoops` is cleared as soon
// as a session's queue empties, so by the time the user switches or quits, the
// loop that held the conversation is gone.
// =============================================================================

import { extractMemories } from "./extract.js";
import { shouldExtract } from "./extract-policy.js";
import { logger } from "../utils/logger.js";

// Matches the loop's own transcript budget: enough to judge durability without
// paying for a whole session.
const MAX_TRANSCRIPT_CHARS = 12_000;

/**
 * The minimum shape a transcript needs: a role and some text parts.
 *
 * Structural rather than `Message` on purpose — the session store hands back
 * `SerializedMessage`, and the two differ in ways that do not matter here.
 * Depending on the narrow shape means neither type has to change for this.
 */
export interface TranscriptMessage {
  role: string;
  parts: Array<{ type: string; content?: string }>;
}

function buildTranscript(messages: TranscriptMessage[]): {
  text: string;
  turns: number;
  lastUserText: string;
} {
  const lines: string[] = [];
  let lastUserText = "";
  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => p.content ?? "")
      .join("")
      .trim();
    if (text.length === 0) continue;
    lines.push(`${msg.role}: ${text}`);
    if (msg.role === "user") lastUserText = text;
  }
  return {
    text: lines.join("\n\n").slice(-MAX_TRANSCRIPT_CHARS),
    turns: lines.length,
    lastUserText,
  };
}

export interface FinalFlushInput {
  sessionId: string;
  projectPath: string;
  provider: string;
  messages: TranscriptMessage[];
}

/**
 * Run a final extraction for an ending session.
 *
 * `force: true` bypasses the interval gate **and nothing else** — both kill
 * switches, the "model already saved this run" gate, and the too-short gate all
 * still apply, because a kill switch a code path can bypass is not a kill
 * switch. Returns how many memories were saved. Never throws.
 */
export async function flushSessionMemory(
  input: FinalFlushInput,
): Promise<number> {
  try {
    const { text, turns, lastUserText } = buildTranscript(input.messages);
    if (text.length === 0) return 0;

    const decision = shouldExtract({
      sessionId: input.sessionId,
      projectRoot: input.projectPath,
      transcript: text,
      turns,
      // The final flush cannot know whether the model saved during the *last*
      // run, and the policy's per-session counter was reset by whoever is
      // ending the session. Reporting `false` is the honest input: it means
      // "no save observed", and the remaining gates still decide.
      memoryToolUsed: false,
      userText: lastUserText,
      force: true,
    });
    if (!decision.extract) {
      logger.debug(`[MemoryFlush] skipped: ${decision.reason}`);
      return 0;
    }

    return await extractMemories({
      transcript: text,
      projectPath: input.projectPath,
      provider: input.provider,
      sessionId: input.sessionId,
    });
  } catch (error) {
    logger.debug("[MemoryFlush] failed", { error });
    return 0;
  }
}
