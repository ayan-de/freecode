import type {
  CompactionConfig,
  MemoryMessage,
  PromptMemoryContext,
  SelectionResult,
} from "./types.js";

function countTokens(messages: MemoryMessage[]): number {
  return messages.reduce((sum, message) => sum + message.tokenCount, 0);
}

function countUserTurns(messages: MemoryMessage[]): number {
  return messages.filter((message) => message.role === "user").length;
}

export function selectForCompaction(
  messages: MemoryMessage[],
  config: CompactionConfig,
): SelectionResult {
  if (countUserTurns(messages) <= config.preserveRecentTurns) {
    return {
      summarize: [],
      preserve: [...messages],
      summarizeTokenCount: 0,
      preserveTokenCount: countTokens(messages),
    };
  }

  let userTurnsSeen = 0;
  let preserveStart = messages.length;

  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") {
      userTurnsSeen++;
      if (userTurnsSeen === config.preserveRecentTurns) {
        preserveStart = index;
        break;
      }
    }
  }

  let preserve = messages.slice(preserveStart);
  while (
    countTokens(preserve) > config.maxPreserveRecentTokens &&
    preserve.length > 1
  ) {
    preserve = preserve.slice(1);
  }

  const firstPreservedId = preserve[0]?.id;
  const firstPreservedIndex = firstPreservedId
    ? messages.findIndex((message) => message.id === firstPreservedId)
    : messages.length;
  let summarize = messages.slice(0, Math.max(0, firstPreservedIndex));

  // Head carve-out. The founding instruction is the first thing compacted
  // away otherwise, and on the *next* compaction the summary of it is
  // summarized again — the brief decays faster than anything else in the
  // window, which is the plausible mechanism behind long-session drift off
  // the task. Keeping it verbatim costs a bounded, one-off few hundred
  // tokens. It is prepended after the tail-trimming loop above deliberately:
  // trimming must never be able to evict the brief.
  const headIndex = summarize.findIndex((message) => message.role === "user");
  const head = headIndex === -1 ? undefined : summarize[headIndex];
  if (head && head.tokenCount <= config.maxPreserveHeadTokens) {
    summarize = summarize.filter((message) => message.id !== head.id);
    preserve = [head, ...preserve];
  }

  return {
    summarize,
    preserve,
    summarizeTokenCount: countTokens(summarize),
    preserveTokenCount: countTokens(preserve),
  };
}

export function renderPromptMemoryContext(
  context: PromptMemoryContext,
): string {
  const sections: string[] = [];

  if (context.summary) {
    sections.push("Compacted session summary:");
    sections.push(context.summary);
  }

  if (context.recentMessages.length > 0) {
    sections.push("Recent session messages:");
    for (const message of context.recentMessages) {
      sections.push(`${message.role}: ${message.content}`);
    }
  }

  return sections.join("\n\n");
}
