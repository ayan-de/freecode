import type { CompactionSummary, MemoryMessage } from "./types.js";
import { estimateTokenCount } from "./tokens.js";

export interface SummarizeInput {
  sessionId: string;
  previousSummary?: string;
  messages: MemoryMessage[];
}

/**
 * Wrap summary content (from either the heuristic or an LLM) into a
 * CompactionSummary, computing the token bookkeeping consistently.
 */
export function makeSummary(
  input: SummarizeInput,
  content: string,
): CompactionSummary {
  const originalTokenCount = input.messages.reduce(
    (sum, message) => sum + message.tokenCount,
    0,
  );
  return {
    id: `summary-${input.sessionId}-${Date.now()}`,
    createdAt: Date.now(),
    originalMessageCount: input.messages.length,
    originalTokenCount,
    summaryTokenCount: estimateTokenCount(content),
    content,
  };
}

function clip(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}...`;
}

/**
 * Extract file paths from message content
 */
function extractFiles(messages: MemoryMessage[]): Set<string> {
  const files = new Set<string>();
  for (const message of messages) {
    for (const match of message.content.matchAll(
      /(?:apps|packages|docs)\/[^\s)`'"]+/g,
    )) {
      files.add(match[0]);
    }
  }
  return files;
}

/**
 * Classify each message into at most one status bucket.
 * Priority: blocked > in progress > done — a message like "no errors, all
 * done" must not land in two buckets, and blockers matter most after
 * compaction.
 */
// ponytail: keyword heuristic; upgrade path is an LLM summary via the
// provider once a side-channel exists (browser providers share the chat).
function extractWorkStatus(messages: MemoryMessage[]): {
  done: string[];
  inProgress: string[];
  blocked: string[];
} {
  const done: string[] = [];
  const inProgress: string[] = [];
  const blocked: string[] = [];

  for (const msg of messages) {
    const content = msg.content.toLowerCase();
    const summary = clip(msg.content, 120);

    // Word-boundary match so "no errors"/"error handling" don't count as a
    // blocker, and negations ("no error", "without errors") are excluded.
    const isBlocked =
      /\b(blocked|waiting|errors?|failed|failing)\b/.test(content) &&
      !/\b(no|without|zero|resolved|fixed)\s+(errors?|blockers?|issues?)\b/.test(
        content,
      );

    if (isBlocked) {
      if (!blocked.includes(summary)) blocked.push(summary);
    } else if (
      content.includes("working on") ||
      content.includes("in progress") ||
      content.includes("currently")
    ) {
      if (!inProgress.includes(summary)) inProgress.push(summary);
    } else if (
      content.includes("completed") ||
      content.includes("done") ||
      content.includes("finished")
    ) {
      if (!done.includes(summary)) done.push(summary);
    }
  }

  return { done, inProgress, blocked };
}

/**
 * Extract tool names that were called
 */
function extractToolCalls(messages: MemoryMessage[]): string[] {
  const tools = new Set<string>();
  for (const msg of messages) {
    for (const match of msg.content.matchAll(/Tool (\w+):/g)) {
      tools.add(match[1]);
    }
  }
  return [...tools];
}

export function summarizeMessages(input: SummarizeInput): CompactionSummary {
  const userMessages = input.messages.filter(
    (message) => message.role === "user",
  );
  const assistantMessages = input.messages.filter(
    (message) => message.role === "assistant",
  );
  const files = extractFiles(input.messages);
  const workStatus = extractWorkStatus(input.messages);
  const toolCalls = extractToolCalls(input.messages);

  // Build structured summary
  const lines: string[] = [];

  // Goal section
  lines.push("## Goal");
  lines.push(
    `- ${clip(userMessages[0]?.content ?? "Continue the current coding session.", 240)}`,
  );

  // Previous summary for continuity
  if (input.previousSummary) {
    lines.push("");
    lines.push("## Previous Summary");
    lines.push(clip(input.previousSummary, 1_500));
  }

  // Done section - what was completed
  lines.push("");
  lines.push("## Done");
  if (workStatus.done.length > 0) {
    for (const item of workStatus.done.slice(0, 5)) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push("- (none)");
  }

  // In Progress section
  lines.push("");
  lines.push("## In Progress");
  if (workStatus.inProgress.length > 0) {
    for (const item of workStatus.inProgress.slice(0, 3)) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push("- (none)");
  }

  // Blocked section
  lines.push("");
  lines.push("## Blocked");
  if (workStatus.blocked.length > 0) {
    for (const item of workStatus.blocked.slice(0, 3)) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push("- (none)");
  }

  // Decisions section - tools that were called indicate decisions made
  lines.push("");
  lines.push("## Decisions");
  if (toolCalls.length > 0) {
    lines.push(`- Tools used: ${toolCalls.join(", ")}`);
    lines.push("- (see Recent Progress for details)");
  } else {
    lines.push("- (none)");
  }

  // Recent Progress section - last few assistant messages
  lines.push("");
  lines.push("## Recent Progress");
  if (assistantMessages.length > 0) {
    for (const message of assistantMessages.slice(-3)) {
      lines.push(`- ${clip(message.content, 200)}`);
    }
  } else {
    lines.push("- (none)");
  }

  // Relevant Files section
  lines.push("");
  lines.push("## Relevant Files");
  const fileList = [...files].slice(0, 15);
  if (fileList.length > 0) {
    for (const file of fileList) {
      lines.push(`- ${file}`);
    }
  } else {
    lines.push("- (none)");
  }

  // Next Steps section
  lines.push("");
  lines.push("## Next Steps");
  lines.push(
    `- This summary replaces ${input.messages.length} older messages that were compacted away`,
  );
  if (assistantMessages.length > 0) {
    lines.push("- Continue from where the session left off");
  }

  return makeSummary(input, lines.join("\n"));
}
