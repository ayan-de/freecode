// =============================================================================
// Ask/review prompting, shared by every web-session provider.
//
// These backends are chat-tuned UI models reached through an undocumented
// endpoint. They have no native tool calling, and emulating it over text was
// measured at ~56% compliance on Gemini — the other 44% answered from priors
// with total fluency, inventing file contents. So none of them get tools.
// The user names files with @mentions, core reads them, and the model only
// does what it is reliable at: reading text already in front of it.
//
// The endpoints also take ONE string rather than a message array, so history
// is flattened with role labels.
// =============================================================================

import type { Message, MessagePart } from "../../agent/types.js";
import { findMentions, inlineFiles } from "./inline.js";

// Short on purpose. Measured against freecode's full 100 KB preamble, a 1.8 KB
// one scored identically — and every byte here is re-sent on every turn against
// an opaque request quota.
export const ASK_REVIEW_SYSTEM_PROMPT = [
  "You are a code reading assistant. The user works in a software project and",
  "will reference files with @mentions; the full contents of those files are",
  "included in the message.",
  "",
  "Answer the question directly and concisely. Quote exactly — never invent",
  "code, filenames, line numbers or output that is not present in what you were",
  "given. You cannot open files, run commands, or edit anything.",
  "",
  // An earlier draft ended "say which one and stop", and it was obeyed too
  // well: one mistyped filename among several made the model refuse the whole
  // question instead of answering the parts it had the files for.
  "If a file you need was not included, name it and answer whatever the",
  "included files do cover — do not guess at the rest.",
].join("\n");

/** Text of a message. Tool and image parts are dropped rather than rendered —
 *  these providers never produce them, and a resumed session that carries them
 *  should not start narrating a tool history the model cannot act on. */
export function textOf(message: Message): string {
  return message.parts
    .map((part: MessagePart) =>
      part.type === "text"
        ? part.content
        : part.type === "code"
          ? `\`\`\`${part.language}\n${part.content}\n\`\`\``
          : "",
    )
    .filter(Boolean)
    .join("\n");
}

export interface FlattenOptions {
  /** How much of the payload may be spent on inlined files. Every site has its
   *  own request ceiling, so the caller sets this. */
  budgetBytes?: number;
  /** Rendered ahead of the history. */
  system?: string;
}

/**
 * History as one prompt string, with every file the conversation has mentioned
 * inlined ONCE, appended to the newest user message.
 *
 * Not "mentions in the newest message only", which was the first cut: these
 * transports keep no server-side thread, so a file named on turn 1 is simply
 * gone by turn 2 — measured, the follow-up turn dropped to 634 bytes and the
 * model correctly answered that it had never been shown the file. Not "expand
 * in place" either, which re-sends the same bytes once per turn that mentioned
 * them. Collected newest-first so that when the budget runs out it is the
 * stalest file that gets dropped, not the one just asked about.
 */
export function flattenConversation(
  messages: Message[],
  options: FlattenOptions = {},
): string {
  // The agent loop prepends a synthetic message carrying the file tree, git
  // head and clock. It is the single largest contributor to the 100 KB measured
  // above and answers nothing here, since files come in by name.
  const usable = messages.filter((m) => m.id !== "dynamic-context");
  const lastUserIndex = usable.map((m) => m.role).lastIndexOf("user");

  const mentions: string[] = [];
  for (let i = usable.length - 1; i >= 0; i--) {
    if (usable[i].role !== "user") continue;
    for (const mention of findMentions(textOf(usable[i]))) {
      if (!mentions.includes(mention)) mentions.push(mention);
    }
  }
  const { block } = inlineFiles(mentions, process.cwd(), options.budgetBytes);

  // Only the assistant is labelled: an unlabelled paragraph reads as the user
  // speaking, which is what the model should treat as the live instruction.
  const parts: string[] = [];
  if (options.system) parts.push(`[System instruction]: ${options.system}`);
  usable.forEach((message, index) => {
    let text = textOf(message);
    if (index === lastUserIndex && block) text = `${text}\n\n${block}`;
    if (!text) return;
    parts.push(message.role === "assistant" ? `[Assistant]: ${text}` : text);
  });
  return parts.join("\n\n");
}
