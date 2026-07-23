import type { AIProvider } from "../providers/types.js";
import type { MemoryMessage } from "./types.js";
import type { SummarizeInput } from "./summarizer.js";

/**
 * Produces the markdown body of a compaction summary. Throws on failure so the
 * caller can fall back to the heuristic summarizer.
 */
export type LlmSummarize = (input: SummarizeInput) => Promise<string>;

const SYSTEM_PROMPT = `You compress a coding-assistant session into a concise handoff summary so work can continue after older messages are dropped.

Output GitHub-flavored markdown using exactly these section headers, in this order:
## Goal
## Done
## In Progress
## Blocked
## Decisions
## Relevant Files
## Next Steps

Rules:
- Be factual and terse. Do not invent progress that isn't in the transcript.
- Preserve exact file paths, identifiers, commands, and unresolved errors.
- Under "Blocked", list only real, still-open blockers.
- If a section has nothing, write "- (none)".`;

function renderTranscript(messages: MemoryMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
}

export function createLlmSummarizer(
  provider: AIProvider,
  model: string | undefined,
  abortSignal?: AbortSignal,
): LlmSummarize {
  return async (input) => {
    const parts: string[] = [];
    if (input.previousSummary) {
      parts.push(
        `Previous summary (carry forward and update, don't repeat verbatim):\n\n${input.previousSummary}`,
      );
    }
    parts.push(
      `Session transcript to summarize:\n\n${renderTranscript(input.messages)}`,
    );

    const result = await provider.execute({
      system: SYSTEM_PROMPT,
      prompt: parts.join("\n\n---\n\n"),
      model,
      temperature: 0,
      maxTokens: 1_024,
      abortSignal,
    });

    const content = result.content?.trim();
    if (!content) throw new Error("provider returned an empty summary");
    return content;
  };
}
